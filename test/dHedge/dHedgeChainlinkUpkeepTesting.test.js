const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");
const { provider, loadFixture, deployMockContract } = waffle;
const { parseUnits } = require("@ethersproject/units");
const SuperfluidSDK = require("@superfluid-finance/js-sdk");
const { web3tx } = require("@decentral.ee/web3-helpers");
const {
    getBigNumber,
    getTimeStamp,
    getTimeStampNow,
    getDate,
    getSeconds,
    increaseTime,
    impersonateAccounts
} = require("../../helpers/helpers");

const { constants, ContractFactory } = require("ethers");
// const { deployMockContract } = require("ethereum-waffle");
const CoreABI = require("../../artifacts/contracts/dHedge/dHedgeCore.sol/dHedgeCore.json");
const { defaultAbiCoder } = require("ethers/lib/utils");

const DAI = {
    token: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    decimals: 18
}

const USDC = {
    token: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    decimals: 6
}

// Convex strategies pool (https://app.dhedge.org/pool/0xb232f192041a121f094c669220dc9573ab18163f)
// Supports DAI, SUSHI, USDC, USDT, WBTC, USDCContract and WMATIC
const Pool1 = "0xb232f192041a121f094c669220dc9573ab18163f";

// 3313.fi_poly pool (https://app.dhedge.org/pool/0xf5fa47d9ca6269d85965eaa5af78a35b2ce016d4)
// Supports USDC only
const Pool2 = "0xf5fa47d9ca6269d85965eaa5af78a35b2ce016d4";

// Misc pools for testing
const Pool3 = "0x08c272acffa8274531bc1a848cdaead772a76116";
const Pool4 = "0xd797179eb71e7ed31acb6aceea9d83416351ecc3";
const Pool5 = "0xc28b6d9cb7bda6d0db62f8ab5714c8edafe22194";

const USDCWhaleAddr = "0x947d711c25220d8301c087b25ba111fe8cbf6672";
const DAIWhaleAddr = "0x85fcd7dd0a1e1a9fcd5fd886ed522de8221c3ee5";

describe("dHedgeUpkeep Testing", function () {
    const [admin] = provider.getWallets();

    let sf;
    let USDCWhale, DAIWhale;
    let DAIContract, USDCContract, Pool1Token, Pool2Token;
    let USDCx, DAIx;
    let dHedgeHelper, dHedgeStorage, SFHelper;
    let core, coreToken, bank, upkeep, mockCore;

    before(async () => {
        [USDCWhale, DAIWhale, AssetHandler] = await impersonateAccounts([USDCWhaleAddr, DAIWhaleAddr, "0xc715Aa67866A2FEF297B12Cb26E953481AeD2df4"]);
        DAIContract = await ethers.getContractAt("IERC20", DAI.token);
        USDCContract = await ethers.getContractAt("IERC20", USDC.token);

        sf = new SuperfluidSDK.Framework({
            web3,
            version: "v1",
            tokens: ["USDC", "DAI"]
        });

        await sf.initialize();

        USDCx = sf.tokens.USDCx;
        DAIx = sf.tokens.DAIx;

        SFHelperFactory = await ethers.getContractFactory("SFHelper");
        SFHelper = await SFHelperFactory.deploy();
        await SFHelper.deployed();

        dHedgeStorageFactory = await ethers.getContractFactory("dHedgeStorage");
        dHedgeStorage = await dHedgeStorageFactory.deploy();
        await dHedgeStorage.deployed();

        dHedgeHelperFactory = await ethers.getContractFactory("dHedgeHelper", {
            libraries: {
                SFHelper: SFHelper.address
            }
        });
        dHedgeHelper = await dHedgeHelperFactory.deploy();
        await dHedgeHelper.deployed();

        dHedgeBankFactory = await ethers.getContractFactory("dHedgeBank", admin);

        bank = await dHedgeBankFactory.deploy();
        await bank.deployed();

        dHedgeCoreFactory = await ethers.getContractFactory("dHedgeCore", {
            libraries: {
                dHedgeHelper: dHedgeHelper.address,
            },
            admin
        });

        AssetHandlerABI = [
            "function setChainlinkTimeout(uint256 newTimeoutPeriod) external",
            "function owner() external view returns (address)"
        ];

        AssetHandlerContract = await ethers.getContractAt(AssetHandlerABI, "0x760FE3179c8491f4b75b21A81F3eE4a5D616A28a");
        console.log("Current AssetHandler owner: ", (await AssetHandlerContract.owner()));
        await AssetHandlerContract.connect(AssetHandler).setChainlinkTimeout(getSeconds(500).toString());
    });

    async function deployContracts() {
        mockCore = await deployMockContract(admin, CoreABI.abi);

        dHedgeUpkeepFactory = await ethers.getContractFactory("dHedgeUpkeepChainlink", admin);
        upkeep = await dHedgeUpkeepFactory.deploy();
        await upkeep.deployed();

        core = await dHedgeCoreFactory.deploy(
            sf.host.address,
            sf.agreements.cfa.address,
            Pool1,
            bank.address,
            process.env.SF_REG_KEY
        );

        coreToken = await ethers.getContractAt("IERC20", Pool1);

        // core = await dHedgeCoreFactory.deploy(
        //     sf.host.address,
        //     sf.agreements.cfa.address,
        //     Pool2,
        //     process.env.SF_REG_KEY
        // );

        // coreToken = await ethers.getContractAt("IERC20", Pool2);

        await core.deployed();

        await fundAndApproveSuperTokens();
    }

    async function fundAndApproveSuperTokens() {
        await USDCContract.connect(USDCWhale).transfer(admin.address, parseUnits("10000", 6));
        await DAIContract.connect(DAIWhale).transfer(admin.address, parseUnits("10000", 18));
        await USDCContract.approve(USDCx.address, parseUnits("1000", 6));
        await DAIContract.approve(DAIx.address, parseUnits("1000", 18));
        await USDCContract.connect(USDCWhale).approve(USDCx.address, parseUnits("1000", 6));
        await DAIContract.connect(USDCWhale).approve(DAIx.address, parseUnits("1000", 18));
        console.log("Tokens funded and approved");
    }

    async function printLPBalances() {
        currLPBalanceBank = await coreToken.balanceOf(bank.address);
        currLPBalanceCore = await coreToken.balanceOf(core.address);
        console.log("Current LP tokens balance of core: ", currLPBalanceCore.toString());
        console.log("Current LP tokens balance of bank: ", currLPBalanceBank.toString());

        return [currLPBalanceCore, currLPBalanceBank];
    }

    function createBatchCall(upgradeAmount = "0", depositAmount = "0", superTokenAddress) {
        return [
            [
                101,
                superTokenAddress,
                defaultAbiCoder.encode(
                    ["uint256"],
                    [parseUnits(upgradeAmount, 18).toString()]
                )
            ],
            [
                201,
                sf.agreements.cfa.address,
                defaultAbiCoder.encode(
                    ["bytes", "bytes"],
                    [
                        sf.agreements.cfa.contract.methods
                            .createFlow(
                                superTokenAddress,
                                core.address,
                                parseUnits(depositAmount, 18).div(getBigNumber(3600 * 24 * 30)),
                                "0x"
                            )
                            .encodeABI(), // callData
                        "0x" // userData
                    ]
                )
            ]
        ];
    }

    it("Should be able to add and remove contracts", async () => {
        await loadFixture(deployContracts);

        await upkeep.addContract(core.address);
        await upkeep.removeContract(core.address);
    });

    it("Should fail if add or remove functions are called by other users", async () => {
        await loadFixture(deployContracts);

        await expect(upkeep.connect(USDCWhale).addContract(core.address)).to.be.revertedWith("Ownable: caller is not the owner");

        await upkeep.addContract(core.address);

        await expect(upkeep.connect(USDCWhale).removeContract(core.address)).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should recognise upkeep request", async () => {
        await loadFixture(deployContracts);

        await upkeep.addContract(mockCore.address);

        await mockCore.mock.requireUpkeep.returns(true);

        expect((await upkeep.checkUpkeep("0x")).upkeepNeeded).to.equal(true);
    });

    it.only("Should execute deposit function", async () => {
        await loadFixture(deployContracts);

        await web3tx(
            sf.host.batchCall,
            "Admin starting a DAI flow"
        )(createBatchCall("1000", "90", DAIx.address), { from: admin.address });

        await web3tx(
            sf.host.batchCall,
            "Admin starting a USDC flow"
        )(createBatchCall("1000", "90", USDCx.address), { from: admin.address });

        await increaseTime(getSeconds(30));

        await upkeep.addContract(core.address);

        result = await upkeep.checkUpkeep("0x");

        expect(result.upkeepNeeded).to.equal(true);
        
        tx = await upkeep.performUpkeep(result.performData);
        receipt = await provider.getTransactionReceipt(tx.hash);
        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();        

        console.log("Gas used: ", receipt.gasUsed.toString());

        expect(await coreToken.balanceOf(core.address)).to.not.equal(constants.Zero);
    });
});
