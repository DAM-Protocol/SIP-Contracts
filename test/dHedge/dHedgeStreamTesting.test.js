const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");
const { provider, loadFixture } = waffle;
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
    setNextBlockTimestamp,
    convertTo,
    convertFrom,
    impersonateAccounts
} = require("../../helpers/helpers");

const DAI = {
    token: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    decimals: 18
}

const USDC = {
    token: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    decimals: 6
}

// Convex strategies pool (https://app.dhedge.org/pool/0xb232f192041a121f094c669220dc9573ab18163f)
// Supports DAI, SUSHI, USDC, USDT, WBTC, WETH and WMATIC
const Pool1 = "0xb232f192041a121f094c669220dc9573ab18163f";

// 3313.fi_poly pool (https://app.dhedge.org/pool/0xf5fa47d9ca6269d85965eaa5af78a35b2ce016d4)
// Supports USDC only
const Pool2 = "0xf5fa47d9ca6269d85965eaa5af78a35b2ce016d4";

const USDCWhaleAddr = "0x947d711c25220d8301c087b25ba111fe8cbf6672";
const DAIWhaleAddr = "0x85fcd7dd0a1e1a9fcd5fd886ed522de8221c3ee5";

describe("dHedgeCore Stream Testing", function () {
    const [admin] = provider.getWallets();

    let sf;
    let USDCWhale, DAIWhale;
    let DAIContract, USDCContract, Pool1Token, Pool2Token;
    let USDCx, DAIx;
    let dHedgeHelper, dHedgeStorage, SFHelper;
    let core, coreToken;

    before(async () => {
        [USDCWhale, DAIWhale] = await impersonateAccounts([USDCWhaleAddr, DAIWhaleAddr]);
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
    });

    async function deployContracts() {
        dHedgeCoreFactory = await ethers.getContractFactory("dHedgeCore", {
            libraries: {
                dHedgeHelper: dHedgeHelper.address,
            },
            admin
        });

        core = await dHedgeCoreFactory.deploy(
            sf.host.address,
            sf.agreements.cfa.address,
            Pool1,
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
        await approveSuperTokens();
    }

    async function approveSuperTokens() {
        await USDCContract.connect(USDCWhale).approve(USDCx.address, parseUnits("1000", 6));
        await DAIContract.connect(DAIWhale).approve(DAIx.address, parseUnits("1000", 18));
        console.log("Tokens approved");
    }

    function createBatchCall(upgradeAmount = "0", depositAmount = "0", superTokenAddress) {
        return [
            [
                101,
                superTokenAddress,
                ethers.utils.defaultAbiCoder.encode(
                    ["uint256"],
                    [parseUnits(upgradeAmount, 18).toString()]
                )
            ],
            [
                201,
                sf.agreements.cfa.address,
                ethers.utils.defaultAbiCoder.encode(
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

    it("Should be able to start a stream", async () => {
        await loadFixture(deployContracts);

        await web3tx(
            sf.host.batchCall,
            "USDCWhale starting a flow"
        )(createBatchCall("1000", "100", USDCx.address), { from: USDCWhale.address });

        await web3tx(
            sf.host.batchCall,
            "DAIWhale starting a flow"
        )(createBatchCall("1000", "100", DAIx.address), { from: DAIWhale.address });

        expect((await sf.agreements.cfa.getNetFlow(DAIx.address, core.address)).toString(), parseUnits("100", 18).div(getSeconds(30)));
        expect((await sf.agreements.cfa.getNetFlow(USDCx.address, core.address)).toString(), parseUnits("100", 18).div(getSeconds(30)));
    });

    it("Should be able to update a stream", async () => {
        await loadFixture(deployContracts);

        await web3tx(
            sf.host.batchCall,
            "USDCWhale starting a flow"
        )(createBatchCall("1000", "100", USDCx.address), { from: USDCWhale.address });

        await web3tx(
            sf.host.batchCall,
            "DAIWhale starting a flow"
        )(createBatchCall("1000", "100", DAIx.address), { from: DAIWhale.address });

        await increaseTime(getSeconds(30));

        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: USDCWhale.address,
            receiver: core.address,
            flowRate: parseUnits("20", 18).div(getSeconds(30))
        });

        await sf.cfa.updateFlow({
            superToken: DAIx.address,
            sender: DAIWhale.address,
            receiver: core.address,
            flowRate: parseUnits("20", 18).div(getSeconds(30))
        });

        expect((await sf.agreements.cfa.getNetFlow(USDCx.address, core.address)).toString(), parseUnits("20", 18).div(getSeconds(30)));
        expect((await sf.agreements.cfa.getNetFlow(DAIx.address, core.address)).toString(), parseUnits("20", 18).div(getSeconds(30)));
    });

    it("Should be able to terminate a stream", async () => {
        await loadFixture(deployContracts);

        await web3tx(
            sf.host.batchCall,
            "USDCWhale starting a flow"
        )(createBatchCall("1000", "100", USDCx.address), { from: USDCWhale.address });

        await web3tx(
            sf.host.batchCall,
            "DAIWhale starting a flow"
        )(createBatchCall("1000", "100", DAIx.address), { from: DAIWhale.address });

        await increaseTime(getSeconds(30));

        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: USDCWhale.address,
            receiver: core.address,
            by: USDCWhale.address
        });

        await sf.cfa.deleteFlow({
            superToken: DAIx.address,
            sender: DAIWhale.address,
            receiver: core.address,
            by: DAIWhale.address
        });

        expect((await sf.agreements.cfa.getNetFlow(USDCx.address, core.address)).toString(), ethers.constants.Zero);
        expect((await sf.agreements.cfa.getNetFlow(DAIx.address, core.address)).toString(), ethers.constants.Zero);
    });
});
