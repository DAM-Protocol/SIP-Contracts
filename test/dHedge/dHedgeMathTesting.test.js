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
    impersonateAccounts
} = require("../../helpers/helpers");
const { defaultAbiCoder } = require("ethers/lib/utils");
const { constants } = require("ethers");

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
// const Pool1 = "0x9e859af5f7de3074039bfadfd0cf566749b94924";

// 3313.fi_poly pool (https://app.dhedge.org/pool/0xf5fa47d9ca6269d85965eaa5af78a35b2ce016d4)
// Supports USDC only
const Pool2 = "0xf5fa47d9ca6269d85965eaa5af78a35b2ce016d4";

const USDCWhaleAddr = "0x947d711c25220d8301c087b25ba111fe8cbf6672";
const DAIWhaleAddr = "0x85fcd7dd0a1e1a9fcd5fd886ed522de8221c3ee5";

describe("dHedgeCore Math Testing", function () {
    const [admin] = provider.getWallets();

    let sf;
    let USDCWhale, DAIWhale;
    let DAIContract, USDCContract, Pool1Token, Pool2Token;
    let USDCx, DAIx;
    let dHedgeHelper, dHedgeStorage, SFHelper;
    let core, coreToken, bank;

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

        AssetHandlerABI = [
            "function setChainlinkTimeout(uint256 newTimeoutPeriod) external",
            "function owner() external view returns (address)"
        ];

        AssetHandlerContract = await ethers.getContractAt(AssetHandlerABI, "0x760FE3179c8491f4b75b21A81F3eE4a5D616A28a");
        console.log("Current AssetHandler owner: ", (await AssetHandlerContract.owner()));
        await AssetHandlerContract.connect(AssetHandler).setChainlinkTimeout(getSeconds(500).toString());
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

    it("Should be able to calculate uninvested amount correctly - 1", async () => {
        await loadFixture(deployContracts);

        await web3tx(
            sf.host.batchCall,
            "Admin starting a flow"
        )(createBatchCall("1000", "100", USDCx.address), { from: admin.address });

        await increaseTime(getSeconds(30));

        currUninvested = await core.calcUserUninvested(admin.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("100", 18), parseUnits("1", 18));

        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("20", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        currUninvested = await core.calcUserUninvested(admin.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("120", 18), parseUnits("1", 18));

        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        await increaseTime(getSeconds(30));

        currUninvested = await core.calcUserUninvested(admin.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("120", 18), parseUnits("1", 18));

        await sf.cfa.createFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("50", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        currUninvested = await core.calcUserUninvested(admin.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("170", 18), parseUnits("1", 18));

        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        currUninvested = await core.calcUserUninvested(admin.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("200", 18), parseUnits("1", 18));

        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        await increaseTime(getSeconds(30));

        currUninvested = await core.calcUserUninvested(admin.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("200", 18), parseUnits("1", 18));
    });

    it("Should be able to calculate uninvested amount correctly - 2", async () => {
        await loadFixture(deployContracts);

        USDCBalanceBefore = await USDCContract.balanceOf(admin.address);
        console.log("Admin balance before upgrade: ", USDCBalanceBefore.toString());

        await web3tx(
            sf.host.batchCall,
            "Admin starting a flow"
        )(createBatchCall("1000", "90", USDCx.address), { from: admin.address });

        USDCBalanceAfter = await USDCContract.balanceOf(admin.address);
        console.log("Admin balance after upgrade: ", USDCBalanceAfter.toString());

        await increaseTime(getSeconds(25));

        await core.dHedgeDeposit(USDCContract.address);

        await increaseTime(getSeconds(5));

        currUninvested = await core.calcUserUninvested(admin.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("15", 18), parseUnits("1", 18));

        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(25));

        await core.dHedgeDeposit(USDCContract.address);

        await increaseTime(getSeconds(5));

        currUninvested = await core.calcUserUninvested(admin.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

        await increaseTime(getSeconds(5));

        await sf.cfa.createFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

        await increaseTime(getSeconds(25));

        await core.dHedgeDeposit(USDCContract.address);

        await increaseTime(getSeconds(5));

        currUninvested = await core.calcUserUninvested(admin.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("5", 18), parseUnits("1", 18));
    });

    it("Should be able to calculate uninvested amount correctly (multi-token streaming) - 1", async () => {
        await loadFixture(deployContracts);

        await web3tx(
            sf.host.batchCall,
            "Admin starting a DAI flow"
        )(createBatchCall("1000", "100", DAIx.address), { from: admin.address });

        await web3tx(
            sf.host.batchCall,
            "Admin starting a USDC flow"
        )(createBatchCall("1000", "100", USDCx.address), { from: admin.address });

        await increaseTime(getSeconds(30));

        currUninvestedUSDC = await core.calcUserUninvested(admin.address, USDCContract.address);
        currUninvestedDAI = await core.calcUserUninvested(admin.address, DAIContract.address);
        console.log("Current uninvested USDC amount: ", currUninvestedUSDC.toString());
        console.log("Current uninvested DAI amount: ", currUninvestedDAI.toString());

        expect(currUninvestedUSDC).to.be.closeTo(parseUnits("100", 18), parseUnits("1", 18));
        expect(currUninvestedDAI).to.be.closeTo(parseUnits("100", 18), parseUnits("1", 18));

        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("20", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.updateFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("20", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        currUninvestedUSDC = await core.calcUserUninvested(admin.address, USDCContract.address);
        currUninvestedDAI = await core.calcUserUninvested(admin.address, DAIContract.address);
        console.log("Current uninvested USDC amount: ", currUninvestedUSDC.toString());
        console.log("Current uninvested DAI amount: ", currUninvestedDAI.toString());

        expect(currUninvestedUSDC).to.be.closeTo(parseUnits("120", 18), parseUnits("1", 18));
        expect(currUninvestedDAI).to.be.closeTo(parseUnits("120", 18), parseUnits("1", 18));

        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        await sf.cfa.deleteFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        await increaseTime(getSeconds(30));

        currUninvestedUSDC = await core.calcUserUninvested(admin.address, USDCContract.address);
        currUninvestedDAI = await core.calcUserUninvested(admin.address, DAIContract.address);
        console.log("Current uninvested USDC amount: ", currUninvestedUSDC.toString());
        console.log("Current uninvested DAI amount: ", currUninvestedDAI.toString());

        expect(currUninvestedUSDC).to.be.closeTo(parseUnits("120", 18), parseUnits("1", 18));
        expect(currUninvestedDAI).to.be.closeTo(parseUnits("120", 18), parseUnits("1", 18));


        await sf.cfa.createFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("50", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.createFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("50", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        currUninvested = await core.calcUserUninvested(admin.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("170", 18), parseUnits("1", 18));

        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.updateFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        currUninvestedUSDC = await core.calcUserUninvested(admin.address, USDCContract.address);
        currUninvestedDAI = await core.calcUserUninvested(admin.address, DAIContract.address);
        console.log("Current uninvested USDC amount: ", currUninvestedUSDC.toString());
        console.log("Current uninvested DAI amount: ", currUninvestedDAI.toString());

        expect(currUninvestedUSDC).to.be.closeTo(parseUnits("200", 18), parseUnits("1", 18));
        expect(currUninvestedDAI).to.be.closeTo(parseUnits("200", 18), parseUnits("1", 18));

        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        await sf.cfa.deleteFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        await increaseTime(getSeconds(30));

        currUninvestedUSDC = await core.calcUserUninvested(admin.address, USDCContract.address);
        currUninvestedDAI = await core.calcUserUninvested(admin.address, DAIContract.address);
        console.log("Current uninvested USDC amount: ", currUninvestedUSDC.toString());
        console.log("Current uninvested DAI amount: ", currUninvestedDAI.toString());

        expect(currUninvestedUSDC).to.be.closeTo(parseUnits("200", 18), parseUnits("1", 18));
        expect(currUninvestedDAI).to.be.closeTo(parseUnits("200", 18), parseUnits("1", 18));
    });

    it("Should be able to calculate a user's share correctly (single-token)", async () => {
        await loadFixture(deployContracts);

        await web3tx(
            sf.host.batchCall,
            "Admin starting a USDC flow"
        )(createBatchCall("1000", "90", USDCx.address), { from: admin.address });

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(USDCContract.address);

        await core.calcWithdrawable(admin.address);
        await printLPBalances();

        console.log("USDCx balance of the core before update: ", (await USDCx.balanceOf(core.address)).toString());
        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });
        console.log("USDCx balance of the core after update: ", (await USDCx.balanceOf(core.address)).toString());
        console.log("User uninvested amount after update: ", (await core.calcUserUninvested(admin.address, USDCContract.address)).toString());

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(USDCContract.address);

        await core.calcWithdrawable(admin.address);
        await printLPBalances();

        console.log("USDCx balance of the core before deletion: ", (await USDCx.balanceOf(core.address)).toString());
        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });
        console.log("USDCx balance of the core after deletion: ", (await USDCx.balanceOf(core.address)).toString());
        console.log("User uninvested amount after deletion: ", (await core.calcUserUninvested(admin.address, USDCContract.address)).toString());

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(USDCContract.address);

        await core.calcWithdrawable(admin.address);
        await printLPBalances();

        console.log("USDCx balance of the core before creation: ", (await USDCx.balanceOf(core.address)).toString());
        await sf.cfa.createFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });
        console.log("USDCx balance of the core after creation: ", (await USDCx.balanceOf(core.address)).toString());
        console.log("User uninvested amount after creation: ", (await core.calcUserUninvested(admin.address, USDCContract.address)).toString());

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(USDCContract.address);

        await printLPBalances();
        console.log("USDCx balance of the core: ", (await USDCx.balanceOf(core.address)).toString());
        console.log("Current user uninvested amount: ", (await core.calcUserUninvested(admin.address, USDCContract.address)).toString());
    });

    it("Should be able to calculate a user's share correctly (single-user-multi-token)", async () => {
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

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        await core.calcWithdrawable(admin.address);
        await core.calcWithdrawable(admin.address);
        await printLPBalances();

        await sf.cfa.updateFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        await core.calcWithdrawable(admin.address);
        await core.calcWithdrawable(admin.address);
        await printLPBalances();

        await sf.cfa.deleteFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        await core.calcWithdrawable(admin.address);
        await core.calcWithdrawable(admin.address);
        await printLPBalances();


        await sf.cfa.createFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.createFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        await printLPBalances();
        await core.calcWithdrawable(admin.address);
        await core.calcWithdrawable(admin.address);

    });

    it("Should be able to calculate a user's share correctly (multi-user-single-token)", async () => {
        await loadFixture(deployContracts);

        await web3tx(
            sf.host.batchCall,
            "Admin starting a USDCx flow"
        )(createBatchCall("1000", "90", USDCx.address), { from: admin.address });

        await web3tx(
            sf.host.batchCall,
            "USDCWhale starting a USDCx flow"
        )(createBatchCall("1000", "90", USDCx.address), { from: USDCWhale.address });

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(USDCContract.address);

        await core.calcWithdrawable(admin.address);
        await core.calcWithdrawable(USDCWhale.address);
        await printLPBalances();


        console.log("USDCx balance of the core before updation: ", (await USDCx.balanceOf(core.address)).toString());
        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: USDCWhale.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });
        console.log("USDCx balance of the core after updation: ", (await USDCx.balanceOf(core.address)).toString());

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(USDCContract.address);

        await printLPBalances();
        await core.calcWithdrawable(admin.address);
        await core.calcWithdrawable(USDCWhale.address);

        console.log("USDCx balance of the core before deletion: ", (await USDCx.balanceOf(core.address)).toString());
        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: USDCWhale.address,
            receiver: core.address,
            by: USDCWhale.address
        });
        console.log("USDCx balance of the core after deletion: ", (await USDCx.balanceOf(core.address)).toString());

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(USDCContract.address);

        await printLPBalances();
        await core.calcWithdrawable(admin.address);
        await core.calcWithdrawable(USDCWhale.address);

        console.log("USDCx balance of the core before creation: ", (await USDCx.balanceOf(core.address)).toString());
        await sf.cfa.createFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.createFlow({
            superToken: USDCx.address,
            sender: USDCWhale.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });
        console.log("USDCx balance of the core after creation: ", (await USDCx.balanceOf(core.address)).toString());

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(USDCContract.address);

        await increaseTime(getSeconds(1));

        await core.calcWithdrawable(admin.address);
        await core.calcWithdrawable(USDCWhale.address);
        await printLPBalances();
    });

    it("Should be able to calculate amounts correctly after withdrawal of uninvested amount (single-token)", async () => {
        await loadFixture(deployContracts);

        await web3tx(
            sf.host.batchCall,
            "Admin starting a DAI flow"
        )(createBatchCall("1000", "90", DAIx.address), { from: admin.address });

        await increaseTime(getSeconds(30));

        await core.connect(admin).withdrawUninvestedSingle(DAIContract.address, parseUnits("30", 18));

        await increaseTime(getSeconds(5));

        await core.dHedgeDeposit(DAIContract.address);

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();

        // await core.connect(admin).withdrawUninvestedSingle(DAIContract.address, parseUnits("165", 18));
        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

        await sf.cfa.updateFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await increaseTime(getSeconds(5));
        await core.moveLPT();

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("0.01", 18));
        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

        await sf.cfa.deleteFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("0.01", 18));

        await core.connect(admin).withdrawUninvestedSingle(DAIContract.address, parseUnits("10", 18));

        console.log("User uninvested amount: ", (await core.calcUserUninvested(admin.address, DAIContract.address)).toString());

        await increaseTime(getSeconds(1));

        await sf.cfa.createFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        console.log("Uninvested amount left: ", (await core.calcUserUninvested(admin.address, DAIContract.address)).toString());
        console.log("Withdrawable amount left: ", (await core.calcWithdrawable(admin.address)).toString());
    });

    it("Should be able to calculate amounts correctly after withdrawal of uninvested amount (multi-token)", async () => {
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

        await core.connect(admin).withdrawUninvestedSingle(DAIContract.address, parseUnits("30", 18));
        await core.connect(admin).withdrawUninvestedSingle(USDCContract.address, parseUnits("30", 18));

        await increaseTime(getSeconds(5));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

        await sf.cfa.updateFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        await increaseTime(getSeconds(5));
        await core.moveLPT();

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("0.01", 18));
        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

        await sf.cfa.deleteFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("0.01", 18));

        await core.connect(admin).withdrawUninvestedSingle(DAIContract.address, parseUnits("10", 18));
        await core.connect(admin).withdrawUninvestedSingle(USDCContract.address, parseUnits("10", 18));

        console.log("User uninvested amount: ", (await core.calcUserUninvested(admin.address, DAIContract.address)).toString());
        console.log("User uninvested amount: ", (await core.calcUserUninvested(admin.address, USDCContract.address)).toString());

        await increaseTime(getSeconds(1));

        await sf.cfa.createFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.createFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        console.log("Uninvested amount of DAIx left: ", (await core.calcUserUninvested(admin.address, DAIContract.address)).toString());
        console.log("Uninvested amount of USDCx left: ", (await core.calcUserUninvested(admin.address, USDCContract.address)).toString());
        console.log("Withdrawable amount left: ", (await core.calcWithdrawable(admin.address)).toString());
        console.log("Current LP tokens balance of core: ", (await coreToken.balanceOf(bank.address)).toString());
    });

    it("Should be able to withdraw all the uninvested amount of tokens", async () => {
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

        await core.connect(admin).withdrawUninvestedAll();

        await increaseTime(getSeconds(5));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

        await sf.cfa.updateFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        await increaseTime(getSeconds(5));
        await core.moveLPT();

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("0.01", 18));
        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

        await sf.cfa.deleteFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("0.01", 18));

        await core.withdrawUninvestedAll();

        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

        await increaseTime(getSeconds(1));

        await sf.cfa.createFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.createFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        expect(await core.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
        expect(await core.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        console.log("Uninvested amount of DAIx left: ", (await core.calcUserUninvested(admin.address, DAIContract.address)).toString());
        console.log("Uninvested amount of USDCx left: ", (await core.calcUserUninvested(admin.address, USDCContract.address)).toString());
        console.log("Withdrawable amount left: ", (await core.calcWithdrawable(admin.address)).toString());
        console.log("Current LP tokens balance of bank: ", (await coreToken.balanceOf(bank.address)).toString());
    });

    it("Should be able to withdraw LP tokens", async () => {
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

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcWithdrawable(admin.address)).to.equal(constants.Zero);

        // Mandatory for withdrawing tokens (cooldown ends)
        await increaseTime(getSeconds(1));
        await core.moveLPT();

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();

        expect(currLPBalanceCore).to.equal(constants.Zero);
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));

        await core.connect(admin).dHedgeWithdraw(currLPBalanceBank.div(4));

        expect(await coreToken.balanceOf(admin.address)).to.be.closeTo(currLPBalanceBank.div(4), parseUnits("1", 18));
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank.mul(3).div(4), parseUnits("1", 18));

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();

        await sf.cfa.updateFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.updateFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        await printLPBalances();

        await increaseTime(getSeconds(1));
        await core.moveLPT();

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));

        await core.connect(admin).dHedgeWithdraw(currLPBalanceBank.mul(3).div(4));
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank.div(4), parseUnits("1", 18));

        await sf.cfa.deleteFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        await sf.cfa.deleteFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            by: admin.address
        });

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));

        await core.connect(admin).dHedgeWithdraw(constants.MaxUint256);
        expect(await core.calcWithdrawable(admin.address)).to.be.closeTo(constants.Zero, parseUnits("1", 18));

        await increaseTime(getSeconds(1));

        await sf.cfa.createFlow({
            superToken: DAIx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        await sf.cfa.createFlow({
            superToken: USDCx.address,
            sender: admin.address,
            receiver: core.address,
            flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
        });

        await increaseTime(getSeconds(30));

        await core.dHedgeDeposit(DAIContract.address);
        await core.dHedgeDeposit(USDCContract.address);

        await increaseTime(getSeconds(1));
        await core.moveLPT();

        [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
        console.log("Withdrawable amount left: ", (await core.calcWithdrawable(admin.address)).toString());
    });
});
