const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");
const { provider, loadFixture, deployMockContract } = waffle;
const { parseUnits } = require("@ethersproject/units");
const SuperfluidSDK = require("@superfluid-finance/sdk-core");
const SuperfluidGovernanceBase = require("@superfluid-finance/ethereum-contracts/build/contracts/SuperfluidGovernanceII.json");
const dHEDGEPoolLogic = require("@dhedge/v2-sdk/src/abi/PoolLogic.json");
const dHEDGEPoolFactory = require("../../helpers/PoolFactoryABI.json");
const {
    getBigNumber,
    getTimeStamp,
    getTimeStampNow,
    getDate,
    getSeconds,
    increaseTime,
    setNextBlockTimestamp,
    impersonateAccounts
} = require("../../helpers/helpers");
const { defaultAbiCoder, keccak256 } = require("ethers/lib/utils");
const { constants } = require("ethers");

describe("dHedgeCore Math Testing", function () {
    const DAI = {
        token: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
        superToken: "0x1305f6b6df9dc47159d12eb7ac2804d4a33173c2",
        decimals: 18
    }
    const USDC = {
        token: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
        superToken: "0xcaa7349cea390f89641fe306d93591f87595dc1f",
        decimals: 6
    }
    const SFConfig = {
        hostAddress: "0x3E14dC1b13c488a8d5D310918780c983bD5982E7",
        CFAv1: "0x6EeE6060f715257b970700bc2656De21dEdF074C",
        IDAv1: "0xB0aABBA4B2783A72C52956CDEF62d438ecA2d7a1"
    }

    const hostABI = [
        "function getGovernance() external view returns (address)",
        "function getSuperTokenFactory() external view returns(address)"
    ];

    const USDCWhaleAddr = "0x947d711c25220d8301c087b25ba111fe8cbf6672";
    const DAIWhaleAddr = "0x85fcd7dd0a1e1a9fcd5fd886ed522de8221c3ee5";
    const DAIWhaleAddr2 = "0x4A35582a710E1F4b2030A3F826DA20BfB6703C09";

    // dHEDGE Stablecoin Yield (https://app.dhedge.org/pool/0xbae28251b2a4e621aa7e20538c06dee010bc06de)
    // Supports DAI and USDC
    const Pool1 = "0xbae28251b2a4e621aa7e20538c06dee010bc06de";

    // SNX Debt Mirror (https://app.dhedge.org/pool/0x65bb99e80a863e0e27ee6d09c794ed8c0be47186)
    // Supports USDC only
    const Pool2 = "0x65bb99e80a863e0e27ee6d09c794ed8c0be47186";

    const [admin] = provider.getWallets();
    const ethersProvider = provider;

    let sf, host;
    let USDCWhale, DAIWhale, DAIWhale2;
    let DAIContract, USDCContract;
    let USDCx, DAIx, DHPTx;
    let dHedgeHelper, dHedgeStorage, SFHelper;
    let app, DHPT;

    before(async () => {
        [USDCWhale, DAIWhale, DAIWhale2, AssetHandler] = await impersonateAccounts([
            USDCWhaleAddr,
            DAIWhaleAddr,
            DAIWhaleAddr2,
            "0xc715Aa67866A2FEF297B12Cb26E953481AeD2df4"
        ]);
        DAIContract = await ethers.getContractAt("IERC20", DAI.token);
        USDCContract = await ethers.getContractAt("IERC20", USDC.token);

        // mockPoolLogic = await deployMockContract(admin, dHEDGEPoolLogic.abi);

        sf = await SuperfluidSDK.Framework.create({
            networkName: "hardhat",
            dataMode: "WEB3_ONLY",
            resolverAddress: "0xE0cc76334405EE8b39213E620587d815967af39C", // Polygon mainnet resolver
            protocolReleaseVersion: "v1",
            provider: ethersProvider
        });

        host = await ethers.getContractAt(hostABI, SFConfig.hostAddress);

        USDCx = await sf.loadSuperToken(USDC.superToken);
        DAIx = await sf.loadSuperToken(DAI.superToken);

        DHPTxAddr = await createSuperToken(Pool1);
        DHPTx = await ethers.getContractAt("IERC20", DHPTxAddr);
        DHPT = await ethers.getContractAt("IERC20", Pool1);

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

        AssetHandlerABI = [
            "function setChainlinkTimeout(uint256) external",
            "function owner() external view returns (address)"
        ];

        // PoolFactory = await ethers.getContractAt(JSON.parse(dHEDGEPoolFactory.result), "0xfb185b8A62F7b888755FBB3E3772F9bf33955211");
        // tx = await PoolFactory.createFund(
        //     false,
        //     admin.address,
        //     "Admin",
        //     "dSIP",
        //     "DSIP",
        //     getBigNumber(5000),
        //     [
        //         [USDC.token, true],
        //         [DAI.token, true]
        //     ]
        // );

        // console.log("Pool creation transaction: ", tx);

        // process.exit(0);

        AssetHandlerContract = await ethers.getContractAt(AssetHandlerABI, "0x760FE3179c8491f4b75b21A81F3eE4a5D616A28a");
        console.log("Current AssetHandler owner: ", (await AssetHandlerContract.owner()));
        await AssetHandlerContract.connect(AssetHandler).setChainlinkTimeout(getSeconds(500).toString());

    });

    async function setupEnv() {
        regKey = await createSFRegistrationKey(admin.address);
        dHedgeCoreFactory = await ethers.getContractFactory("dHedgeCore", {
            libraries: {
                SFHelper: SFHelper.address,
                dHedgeHelper: dHedgeHelper.address,
            },
            admin
        });

        app = await dHedgeCoreFactory.deploy(
            Pool1,
            DHPTx.address,
            "20000",
            regKey
        );

        // app = await dHedgeCoreFactory.deploy(
        //     mockPoolLogic.address,
        //     DHPTx.address,
        //     "20000",
        //     regKey
        // );

        await app.deployed();

        await approveAndUpgrade();
    }

    async function createSuperToken(underlyingAddress) {
        superTokenFactoryABI = [
            "function createERC20Wrapper(address, uint8, string, string) external returns(address)",
            "event SuperTokenCreated(address indexed token)"
        ];
        superTokenFactoryAddr = await host.getSuperTokenFactory();
        superTokenFactory = await ethers.getContractAt(superTokenFactoryABI, superTokenFactoryAddr, admin);

        await superTokenFactory.createERC20Wrapper(underlyingAddress, 1, "dHEDGE Stablecoin Yield", "dUSDx");
        superTokenFilter = await superTokenFactory.filters.SuperTokenCreated();
        response = await superTokenFactory.queryFilter(superTokenFilter, -1, "latest");

        return response[0].args[0];
    }

    async function approveAndUpgrade() {
        await USDCContract.connect(USDCWhale).approve(USDC.superToken, parseUnits("1000000", 6));
        await DAIContract.connect(DAIWhale).approve(DAI.superToken, parseUnits("1000000", 18));
        await DAIContract.connect(DAIWhale2).approve(DAI.superToken, parseUnits("1000000", 18));

        await USDCx.upgrade({ amount: parseUnits("10000", 18) }).exec(USDCWhale);
        await DAIx.upgrade({ amount: parseUnits("10000", 18) }).exec(DAIWhale);
        await DAIx.upgrade({ amount: parseUnits("10000", 18) }).exec(DAIWhale2);

        await USDCx.transfer({
            receiver: admin.address,
            amount: parseUnits("1000", 18)
        }).exec(USDCWhale);

        await DAIx.transfer({
            receiver: admin.address,
            amount: parseUnits("1000", 18)
        }).exec(DAIWhale);
    }

    async function startAndSub(wallet, superToken, userFlowRate) {
        distIndex = await app.getLatestDistIndex();

        createFlowOp = sf.cfaV1.createFlow({
            superToken: superToken,
            receiver: app.address,
            flowRate: userFlowRate
        });

        approveOp = sf.idaV1.approveSubscription({
            indexId: distIndex.toString(),
            superToken: DHPTx.address,
            publisher: app.address
        });

        await sf.batchCall([createFlowOp, approveOp]).exec(wallet);
    }

    async function createSFRegistrationKey(deployerAddr) {
        registrationKey = `testKey-${Date.now()}`;
        encodedKey = keccak256(
            defaultAbiCoder.encode(
                ["string", "address", "string"],
                [
                    "org.superfluid-finance.superfluid.appWhiteListing.registrationKey",
                    deployerAddr,
                    registrationKey,
                ]
            )
        );

        governance = await host.getGovernance();

        sfGovernanceRO = await ethers.getContractAt(SuperfluidGovernanceBase.abi, governance);

        govOwner = await sfGovernanceRO.owner();
        [govOwnerSigner] = await impersonateAccounts([govOwner]);

        sfGovernance = await ethers.getContractAt(SuperfluidGovernanceBase.abi, governance, govOwnerSigner);

        await sfGovernance.whiteListNewApp(SFConfig.hostAddress, encodedKey);

        return registrationKey;
    }

    async function getIndexDetails(superToken, indexId) {
        response = await sf.idaV1.getIndex({
            superToken: superToken,
            publisher: app.address,
            indexId: indexId,
            providerOrSigner: ethersProvider
        });

        console.log(`Index id ${indexId} exists: ${response.exist}`);
        console.log(`Total units approved for index id ${indexId}: ${response.totalUnitsApproved}`);
        console.log(`Total units pending for index id ${indexId}: ${response.totalUnitsPending}`);

        return response;
    }

    async function getUserUnits(superToken, indexId, userAddr) {
        response = await sf.idaV1.getSubscription({
            superToken: superToken,
            publisher: app.address,
            indexId: indexId,
            subscriber: userAddr,
            providerOrSigner: ethersProvider
        });

        console.log(`Subscription approved for index id ${indexId} and address ${userAddr}: ${response.approved}`);
        console.log(`Units of index id ${indexId} for address ${userAddr}: response.units`);
        console.log(`Pending distribution of index id ${indexId} for address ${userAddr}: ${response.pendingDistribution}`);

        return response;
    }


    async function printDHPTxBalance(accountAddr) {
        currDHPTxBal = await DHPTx.balanceOf({
            account: accountAddr,
            providerOrSigner: ethersProvider
        });

        console.log(`Current DHPTx balance of ${accountAddr}: ${currDHPTxBal}`);

        return currDHPTxBal;
    }

    it("Should be able to calculate uninvested amount correctly - 1", async () => {
        await loadFixture(setupEnv);

        userFlowRate = parseUnits("100", 18).div(getBigNumber(getSeconds(30)));

        await startAndSub(USDCWhale, USDC.superToken, userFlowRate);

        await increaseTime(getSeconds(30));

        currUninvested = await app.calcUserUninvested(USDCWhale.address, USDCContract.address);
        console.log("Current uninvested amount: ", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("100", 18), parseUnits("1", 18));

        userFlowRate = parseUnits("20", 18).div(getBigNumber(getSeconds(30)));

        await sf.cfaV1.updateFlow({
            superToken: USDC.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(USDCWhale);

        await increaseTime(getSeconds(30));

        currUninvested = await app.calcUserUninvested(USDCWhale.address, USDCContract.address);
        console.log("Current uninvested amount: ", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("20", 18), parseUnits("1", 18));

        await sf.cfaV1.deleteFlow({
            superToken: USDC.superToken,
            sender: USDCWhale.address,
            receiver: app.address
        }).exec(USDCWhale);

        await increaseTime(getSeconds(30));

        currUninvested = await app.calcUserUninvested(USDCWhale.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(constants.Zero, parseUnits("1", 18));

        userFlowRate = parseUnits("50", 18).div(getBigNumber(getSeconds(30)));

        await sf.cfaV1.createFlow({
            superToken: USDC.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(USDCWhale);

        await increaseTime(getSeconds(30));

        currUninvested = await app.calcUserUninvested(USDCWhale.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("50", 18), parseUnits("1", 18));

        userFlowRate = parseUnits("30", 18).div(getBigNumber(getSeconds(30)));

        await sf.cfaV1.updateFlow({
            superToken: USDC.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(USDCWhale);

        await increaseTime(getSeconds(30));

        currUninvested = await app.calcUserUninvested(USDCWhale.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("30", 18), parseUnits("1", 18));

        await sf.cfaV1.deleteFlow({
            superToken: USDC.superToken,
            sender: USDCWhale.address,
            receiver: app.address
        }).exec(USDCWhale);

        await increaseTime(getSeconds(30));

        currUninvested = await app.calcUserUninvested(USDCWhale.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(constants.Zero, parseUnits("1", 18));
    });

    it.skip("Should be able to calculate uninvested amount correctly - 2", async () => {
        await loadFixture(setupEnv);

        userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

        await startAndSub(USDCWhale, USDC.superToken, userFlowRate);

        console.log("Reaching here 2");

        await increaseTime(getSeconds(1));

        // await mockPoolLogic.mock.poolManagerLogic.returns("0x2022ae924ce6f6d23581ef8e3dcfbb69ee719fed");
        // await mockPoolLogic.mock.deposit.returns(parseUnits("3", 18));

        await app.dHedgeDeposit(USDCContract.address);

        await increaseTime(getSeconds(1));

        currUninvested = await app.calcUserUninvested(USDCWhale.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("3", 18), parseUnits("1", 18));

        userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

        await sf.cfaV1.updateFlow({
            superToken: USDC.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(USDCWhale);

        await increaseTime(getSeconds(1));

        // await mockPoolLogic.mock.deposit.returns(parseUnits("2", 18));
        await app.dHedgeDeposit(USDCContract.address);

        await increaseTime(getSeconds(1));

        currUninvested = await app.calcUserUninvested(USDCWhale.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("2", 18), parseUnits("1", 18));

        await sf.cfaV1.deleteFlow({
            superToken: USDC.superToken,
            sender: USDCWhale.address,
            receiver: app.address
        }).exec(USDCWhale);

        expect(await app.calcUserUninvested(USDCWhale.address, USDCContract.address)).to.be.closeTo(constants.Zero, parseUnits("1", 18));

        await increaseTime(getSeconds(5));

        userFlowRate = parseUnits("30", 18).div(getBigNumber(3600 * 24 * 30));

        await sf.cfaV1.createFlow({
            superToken: USDC.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(USDCWhale);

        expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(constants.Zero, parseUnits("1", 18));

        await increaseTime(getSeconds(1));

        // await mockPoolLogic.mock.deposit.returns(parseUnits("1", 18));
        await app.dHedgeDeposit(USDCContract.address);

        await increaseTime(getSeconds(1));

        currUninvested = await app.calcUserUninvested(admin.address, USDCContract.address);
        console.log("Current uninvested amount", currUninvested.toString());

        expect(currUninvested).to.be.closeTo(parseUnits("1", 18), parseUnits("1", 18));
    });

    it("Should be able to calculate uninvested amount correctly (multi-token streaming) - 1", async () => {
        await loadFixture(setupEnv);

        userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

        await startAndSub(admin, USDC.superToken, userFlowRate);
        await startAndSub(admin, DAI.superToken, userFlowRate);

        await increaseTime(getSeconds(30));

        currUninvestedUSDC = await app.calcUserUninvested(admin.address, USDCContract.address);
        currUninvestedDAI = await app.calcUserUninvested(admin.address, DAIContract.address);
        console.log("Current uninvested USDC amount: ", currUninvestedUSDC.toString());
        console.log("Current uninvested DAI amount: ", currUninvestedDAI.toString());

        expect(currUninvestedUSDC).to.be.closeTo(parseUnits("60", 18), parseUnits("1", 18));
        expect(currUninvestedDAI).to.be.closeTo(parseUnits("60", 18), parseUnits("1", 18));

        userFlowRate = parseUnits("20", 18).div(getBigNumber(getSeconds(30)));

        await sf.cfaV1.updateFlow({
            superToken: USDC.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(admin);

        await sf.cfaV1.updateFlow({
            superToken: DAI.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(admin);

        await increaseTime(getSeconds(30));

        currUninvestedUSDC = await app.calcUserUninvested(admin.address, USDCContract.address);
        currUninvestedDAI = await app.calcUserUninvested(admin.address, DAIContract.address);
        console.log("Current uninvested USDC amount: ", currUninvestedUSDC.toString());
        console.log("Current uninvested DAI amount: ", currUninvestedDAI.toString());

        expect(currUninvestedUSDC).to.be.closeTo(parseUnits("20", 18), parseUnits("1", 18));
        expect(currUninvestedDAI).to.be.closeTo(parseUnits("20", 18), parseUnits("1", 18));

        await sf.cfaV1.deleteFlow({
            superToken: USDC.superToken,
            sender: admin.address,
            receiver: app.address
        }).exec(admin);

        await sf.cfaV1.deleteFlow({
            superToken: DAI.superToken,
            sender: admin.address,
            receiver: app.address
        }).exec(admin);

        await increaseTime(getSeconds(30));

        currUninvestedUSDC = await app.calcUserUninvested(admin.address, USDCContract.address);
        currUninvestedDAI = await app.calcUserUninvested(admin.address, DAIContract.address);
        console.log("Current uninvested USDC amount: ", currUninvestedUSDC.toString());
        console.log("Current uninvested DAI amount: ", currUninvestedDAI.toString());

        expect(currUninvestedUSDC).to.be.closeTo(constants.Zero, parseUnits("1", 18));
        expect(currUninvestedDAI).to.be.closeTo(constants.Zero, parseUnits("1", 18));


        userFlowRate = parseUnits("50", 18).div(getBigNumber(getSeconds(30)));

        await sf.cfaV1.createFlow({
            superToken: USDC.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(admin);

        await sf.cfaV1.createFlow({
            superToken: DAI.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(admin);

        await increaseTime(getSeconds(30));

        currUninvestedUSDC = await app.calcUserUninvested(admin.address, USDCContract.address);
        currUninvestedDAI = await app.calcUserUninvested(admin.address, DAIContract.address);
        console.log("Current uninvested USDC amount: ", currUninvestedUSDC.toString());
        console.log("Current uninvested DAI amount: ", currUninvestedDAI.toString());

        expect(currUninvestedUSDC).to.be.closeTo(parseUnits("50", 18), parseUnits("1", 18));
        expect(currUninvestedDAI).to.be.closeTo(parseUnits("50", 18), parseUnits("1", 18));

        userFlowRate = parseUnits("30", 18).div(getBigNumber(getSeconds(30)));

        await sf.cfaV1.updateFlow({
            superToken: USDC.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(admin);

        await sf.cfaV1.updateFlow({
            superToken: DAI.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(admin);

        await increaseTime(getSeconds(30));

        currUninvestedUSDC = await app.calcUserUninvested(admin.address, USDCContract.address);
        currUninvestedDAI = await app.calcUserUninvested(admin.address, DAIContract.address);
        console.log("Current uninvested USDC amount: ", currUninvestedUSDC.toString());
        console.log("Current uninvested DAI amount: ", currUninvestedDAI.toString());

        expect(currUninvestedUSDC).to.be.closeTo(parseUnits("30", 18), parseUnits("1", 18));
        expect(currUninvestedDAI).to.be.closeTo(parseUnits("30", 18), parseUnits("1", 18));

        await sf.cfaV1.deleteFlow({
            superToken: USDC.superToken,
            sender: admin.address,
            receiver: app.address
        }).exec(admin);

        await sf.cfaV1.deleteFlow({
            superToken: DAI.superToken,
            sender: admin.address,
            receiver: app.address
        }).exec(admin);

        await increaseTime(getSeconds(30));

        currUninvestedUSDC = await app.calcUserUninvested(admin.address, USDCContract.address);
        currUninvestedDAI = await app.calcUserUninvested(admin.address, DAIContract.address);
        console.log("Current uninvested USDC amount: ", currUninvestedUSDC.toString());
        console.log("Current uninvested DAI amount: ", currUninvestedDAI.toString());

        expect(currUninvestedUSDC).to.be.closeTo(constants.Zero, parseUnits("1", 18));
        expect(currUninvestedDAI).to.be.closeTo(constants.Zero, parseUnits("1", 18));
    });

    //     it("Should be able to calculate a user's share correctly (single-token)", async () => {
    //         await loadFixture(deployContracts);

    //         await web3tx(
    //             sf.host.batchCall,
    //             "Admin starting a USDC flow"
    //         )(createBatchCall("1000", "90", USDCx.address), { from: admin.address });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(USDCContract.address);

    //         await app.calcWithdrawable(admin.address);
    //         await printLPBalances();

    //         console.log("USDCx balance of the app before update: ", (await USDCx.balanceOf(app.address)).toString());
    //         await sf.cfa.updateFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
    //         });
    //         console.log("USDCx balance of the app after update: ", (await USDCx.balanceOf(app.address)).toString());
    //         console.log("User uninvested amount after update: ", (await app.calcUserUninvested(admin.address, USDCContract.address)).toString());

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(USDCContract.address);

    //         await app.calcWithdrawable(admin.address);
    //         await printLPBalances();

    //         console.log("USDCx balance of the app before deletion: ", (await USDCx.balanceOf(app.address)).toString());
    //         await sf.cfa.deleteFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             by: admin.address
    //         });
    //         console.log("USDCx balance of the app after deletion: ", (await USDCx.balanceOf(app.address)).toString());
    //         console.log("User uninvested amount after deletion: ", (await app.calcUserUninvested(admin.address, USDCContract.address)).toString());

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(USDCContract.address);

    //         await app.calcWithdrawable(admin.address);
    //         await printLPBalances();

    //         console.log("USDCx balance of the app before creation: ", (await USDCx.balanceOf(app.address)).toString());
    //         await sf.cfa.createFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
    //         });
    //         console.log("USDCx balance of the app after creation: ", (await USDCx.balanceOf(app.address)).toString());
    //         console.log("User uninvested amount after creation: ", (await app.calcUserUninvested(admin.address, USDCContract.address)).toString());

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(USDCContract.address);

    //         await printLPBalances();
    //         console.log("USDCx balance of the app: ", (await USDCx.balanceOf(app.address)).toString());
    //         console.log("Current user uninvested amount: ", (await app.calcUserUninvested(admin.address, USDCContract.address)).toString());
    //     });

    //     it("Should be able to calculate a user's share correctly (single-user-multi-token)", async () => {
    //         await loadFixture(deployContracts);

    //         await web3tx(
    //             sf.host.batchCall,
    //             "Admin starting a DAI flow"
    //         )(createBatchCall("1000", "90", DAIx.address), { from: admin.address });

    //         await web3tx(
    //             sf.host.batchCall,
    //             "Admin starting a USDC flow"
    //         )(createBatchCall("1000", "90", USDCx.address), { from: admin.address });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         await app.calcWithdrawable(admin.address);
    //         await app.calcWithdrawable(admin.address);
    //         await printLPBalances();

    //         await sf.cfa.updateFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await sf.cfa.updateFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         await app.calcWithdrawable(admin.address);
    //         await app.calcWithdrawable(admin.address);
    //         await printLPBalances();

    //         await sf.cfa.deleteFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             by: admin.address
    //         });

    //         await sf.cfa.deleteFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             by: admin.address
    //         });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         await app.calcWithdrawable(admin.address);
    //         await app.calcWithdrawable(admin.address);
    //         await printLPBalances();


    //         await sf.cfa.createFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await sf.cfa.createFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         await printLPBalances();
    //         await app.calcWithdrawable(admin.address);
    //         await app.calcWithdrawable(admin.address);

    //     });

    //     it("Should be able to calculate a user's share correctly (multi-user-single-token)", async () => {
    //         await loadFixture(deployContracts);

    //         await web3tx(
    //             sf.host.batchCall,
    //             "Admin starting a USDCx flow"
    //         )(createBatchCall("1000", "90", USDCx.address), { from: admin.address });

    //         await web3tx(
    //             sf.host.batchCall,
    //             "USDCWhale starting a USDCx flow"
    //         )(createBatchCall("1000", "90", USDCx.address), { from: USDCWhale.address });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(USDCContract.address);

    //         await app.calcWithdrawable(admin.address);
    //         await app.calcWithdrawable(USDCWhale.address);
    //         await printLPBalances();


    //         console.log("USDCx balance of the app before updation: ", (await USDCx.balanceOf(app.address)).toString());
    //         await sf.cfa.updateFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await sf.cfa.updateFlow({
    //             superToken: USDCx.address,
    //             sender: USDCWhale.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
    //         });
    //         console.log("USDCx balance of the app after updation: ", (await USDCx.balanceOf(app.address)).toString());

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(USDCContract.address);

    //         await printLPBalances();
    //         await app.calcWithdrawable(admin.address);
    //         await app.calcWithdrawable(USDCWhale.address);

    //         console.log("USDCx balance of the app before deletion: ", (await USDCx.balanceOf(app.address)).toString());
    //         await sf.cfa.deleteFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             by: admin.address
    //         });

    //         await sf.cfa.deleteFlow({
    //             superToken: USDCx.address,
    //             sender: USDCWhale.address,
    //             receiver: app.address,
    //             by: USDCWhale.address
    //         });
    //         console.log("USDCx balance of the app after deletion: ", (await USDCx.balanceOf(app.address)).toString());

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(USDCContract.address);

    //         await printLPBalances();
    //         await app.calcWithdrawable(admin.address);
    //         await app.calcWithdrawable(USDCWhale.address);

    //         console.log("USDCx balance of the app before creation: ", (await USDCx.balanceOf(app.address)).toString());
    //         await sf.cfa.createFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await sf.cfa.createFlow({
    //             superToken: USDCx.address,
    //             sender: USDCWhale.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
    //         });
    //         console.log("USDCx balance of the app after creation: ", (await USDCx.balanceOf(app.address)).toString());

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(USDCContract.address);

    //         await increaseTime(getSeconds(1));

    //         await app.calcWithdrawable(admin.address);
    //         await app.calcWithdrawable(USDCWhale.address);
    //         await printLPBalances();
    //     });

    //     it("Should be able to calculate amounts correctly after withdrawal of uninvested amount (single-token)", async () => {
    //         await loadFixture(deployContracts);

    //         await web3tx(
    //             sf.host.batchCall,
    //             "Admin starting a DAI flow"
    //         )(createBatchCall("1000", "90", DAIx.address), { from: admin.address });

    //         await increaseTime(getSeconds(30));

    //         await app.connect(admin).withdrawUninvestedSingle(DAIContract.address, parseUnits("30", 18));

    //         await increaseTime(getSeconds(5));

    //         await app.dHedgeDeposit(DAIContract.address);

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();

    //         // await app.connect(admin).withdrawUninvestedSingle(DAIContract.address, parseUnits("165", 18));
    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

    //         await sf.cfa.updateFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await increaseTime(getSeconds(5));
    //         await app.moveLPT();

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("0.01", 18));
    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

    //         await sf.cfa.deleteFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             by: admin.address
    //         });

    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("0.01", 18));

    //         await app.connect(admin).withdrawUninvestedSingle(DAIContract.address, parseUnits("10", 18));

    //         console.log("User uninvested amount: ", (await app.calcUserUninvested(admin.address, DAIContract.address)).toString());

    //         await increaseTime(getSeconds(1));

    //         await sf.cfa.createFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         console.log("Uninvested amount left: ", (await app.calcUserUninvested(admin.address, DAIContract.address)).toString());
    //         console.log("Withdrawable amount left: ", (await app.calcWithdrawable(admin.address)).toString());
    //     });

    //     it("Should be able to calculate amounts correctly after withdrawal of uninvested amount (multi-token)", async () => {
    //         await loadFixture(deployContracts);

    //         await web3tx(
    //             sf.host.batchCall,
    //             "Admin starting a DAI flow"
    //         )(createBatchCall("1000", "90", DAIx.address), { from: admin.address });

    //         await web3tx(
    //             sf.host.batchCall,
    //             "Admin starting a USDC flow"
    //         )(createBatchCall("1000", "90", USDCx.address), { from: admin.address });

    //         await increaseTime(getSeconds(30));

    //         await app.connect(admin).withdrawUninvestedSingle(DAIContract.address, parseUnits("30", 18));
    //         await app.connect(admin).withdrawUninvestedSingle(USDCContract.address, parseUnits("30", 18));

    //         await increaseTime(getSeconds(5));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

    //         await sf.cfa.updateFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await sf.cfa.updateFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         await increaseTime(getSeconds(5));
    //         await app.moveLPT();

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("0.01", 18));
    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

    //         await sf.cfa.deleteFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             by: admin.address
    //         });

    //         await sf.cfa.deleteFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             by: admin.address
    //         });

    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("0.01", 18));

    //         await app.connect(admin).withdrawUninvestedSingle(DAIContract.address, parseUnits("10", 18));
    //         await app.connect(admin).withdrawUninvestedSingle(USDCContract.address, parseUnits("10", 18));

    //         console.log("User uninvested amount: ", (await app.calcUserUninvested(admin.address, DAIContract.address)).toString());
    //         console.log("User uninvested amount: ", (await app.calcUserUninvested(admin.address, USDCContract.address)).toString());

    //         await increaseTime(getSeconds(1));

    //         await sf.cfa.createFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await sf.cfa.createFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         console.log("Uninvested amount of DAIx left: ", (await app.calcUserUninvested(admin.address, DAIContract.address)).toString());
    //         console.log("Uninvested amount of USDCx left: ", (await app.calcUserUninvested(admin.address, USDCContract.address)).toString());
    //         console.log("Withdrawable amount left: ", (await app.calcWithdrawable(admin.address)).toString());
    //         console.log("Current LP tokens balance of app: ", (await coreToken.balanceOf(bank.address)).toString());
    //     });

    //     it("Should be able to withdraw all the uninvested amount of tokens", async () => {
    //         await loadFixture(deployContracts);

    //         await web3tx(
    //             sf.host.batchCall,
    //             "Admin starting a DAI flow"
    //         )(createBatchCall("1000", "90", DAIx.address), { from: admin.address });

    //         await web3tx(
    //             sf.host.batchCall,
    //             "Admin starting a USDC flow"
    //         )(createBatchCall("1000", "90", USDCx.address), { from: admin.address });

    //         await increaseTime(getSeconds(30));

    //         await app.connect(admin).withdrawUninvestedAll();

    //         await increaseTime(getSeconds(5));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

    //         await sf.cfa.updateFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await sf.cfa.updateFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         await increaseTime(getSeconds(5));
    //         await app.moveLPT();

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("0.01", 18));
    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

    //         await sf.cfa.deleteFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             by: admin.address
    //         });

    //         await sf.cfa.deleteFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             by: admin.address
    //         });

    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(parseUnits("10", 18), parseUnits("1", 18));

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("0.01", 18));

    //         await app.withdrawUninvestedAll();

    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

    //         await increaseTime(getSeconds(1));

    //         await sf.cfa.createFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await sf.cfa.createFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         expect(await app.calcUserUninvested(admin.address, DAIContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));
    //         expect(await app.calcUserUninvested(admin.address, USDCContract.address)).to.be.closeTo(ethers.constants.Zero, parseUnits("1", 18));

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         console.log("Uninvested amount of DAIx left: ", (await app.calcUserUninvested(admin.address, DAIContract.address)).toString());
    //         console.log("Uninvested amount of USDCx left: ", (await app.calcUserUninvested(admin.address, USDCContract.address)).toString());
    //         console.log("Withdrawable amount left: ", (await app.calcWithdrawable(admin.address)).toString());
    //         console.log("Current LP tokens balance of bank: ", (await coreToken.balanceOf(bank.address)).toString());
    //     });

    //     it.skip("Should be able to withdraw LP tokens", async () => {
    //         await loadFixture(deployContracts);

    //         await web3tx(
    //             sf.host.batchCall,
    //             "Admin starting a DAI flow"
    //         )(createBatchCall("1000", "90", DAIx.address), { from: admin.address });

    //         await web3tx(
    //             sf.host.batchCall,
    //             "Admin starting a USDC flow"
    //         )(createBatchCall("1000", "90", USDCx.address), { from: admin.address });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.equal(constants.Zero);

    //         // Mandatory for withdrawing tokens (cooldown ends)
    //         await increaseTime(getSeconds(1));
    //         await app.moveLPT();

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();

    //         expect(currLPBalanceCore).to.equal(constants.Zero);
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));

    //         await app.connect(admin).dHedgeWithdraw(currLPBalanceBank.div(4));

    //         expect(await coreToken.balanceOf(admin.address)).to.be.closeTo(currLPBalanceBank.div(4), parseUnits("1", 18));
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank.mul(3).div(4), parseUnits("1", 18));

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();

    //         await sf.cfa.updateFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await sf.cfa.updateFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("60", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         await printLPBalances();

    //         await increaseTime(getSeconds(1));
    //         await app.moveLPT();

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));

    //         await app.connect(admin).dHedgeWithdraw(currLPBalanceBank.mul(3).div(4));
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank.div(4), parseUnits("1", 18));

    //         await sf.cfa.deleteFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             by: admin.address
    //         });

    //         await sf.cfa.deleteFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             by: admin.address
    //         });

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));

    //         // await app.connect(admin).dHedgeWithdraw(constants.MaxUint256);
    //         // expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(constants.Zero, parseUnits("1", 18));

    //         await increaseTime(getSeconds(1));

    //         await sf.cfa.createFlow({
    //             superToken: DAIx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await sf.cfa.createFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("30", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         await increaseTime(getSeconds(30));

    //         await app.dHedgeDeposit(DAIContract.address);
    //         await app.dHedgeDeposit(USDCContract.address);

    //         await increaseTime(getSeconds(1));
    //         await app.moveLPT();

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         console.log("Withdrawable amount left: ", (await app.calcWithdrawable(admin.address)).toString());
    //     });

    //     it.only("Should calculate LP share amount correctly", async() => {
    //         await loadFixture(deployContracts);

    //         await web3tx(
    //             sf.host.batchCall,
    //             "Admin starting a USDC flow"
    //         )(createBatchCall("1000", "30", USDCx.address), { from: admin.address });

    //         // await web3tx(
    //         //     sf.host.batchCall,
    //         //     "Admin starting a DAI flow"
    //         // )(createBatchCall("1000", "90", DAIx.address), { from: admin.address });

    //         await increaseTime(getSeconds(1));
    //         await app.dHedgeDeposit(USDCContract.address);
    //         // await app.dHedgeDeposit(DAIContract.address);

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcWithdrawable(admin.address)).to.equal(constants.Zero);

    //         await increaseTime(60*60*2);
    //         console.log("Withdrawable: ", (await app.calcWithdrawable(admin.address)).toString());

    //         await increaseTime(getSeconds(1));
    //         await app.dHedgeDeposit(USDCContract.address);
    //         // await app.dHedgeDeposit(DAIContract.address);

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcUserLockedShareAmount(admin.address)).to.be.closeTo(currLPBalanceCore, parseUnits("1", 18));
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));

    //         await increaseTime(60*60*2);
    //         console.log("Withdrawable: ", (await app.calcWithdrawable(admin.address)).toString());

    //         await sf.cfa.updateFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             flowRate: parseUnits("20", 18).div(getBigNumber(getSeconds(30)))
    //         });

    //         // await sf.cfa.updateFlow({
    //         //     superToken: DAIx.address,
    //         //     sender: admin.address,
    //         //     receiver: app.address,
    //         //     flowRate: parseUnits("20", 18).div(getBigNumber(getSeconds(30)))
    //         // });

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect(await app.calcUserLockedShareAmount(admin.address)).to.be.closeTo(currLPBalanceCore, parseUnits("1", 18));
    //         expect(await app.calcWithdrawable(admin.address)).to.be.closeTo(currLPBalanceBank, parseUnits("1", 18));

    //         await increaseTime(getSeconds(1));

    //         expect((await app.calcWithdrawable(admin.address)).toString()).to.be.closeTo(currLPBalanceBank.add(currLPBalanceCore), parseUnits("1", 18));
    //         expect(await app.calcUserLockedShareAmount(admin.address)).to.equal(constants.Zero);

    //         await sf.cfa.deleteFlow({
    //             superToken: USDCx.address,
    //             sender: admin.address,
    //             receiver: app.address,
    //             by: admin.address
    //         });

    //         // await sf.cfa.deleteFlow({
    //         //     superToken: DAIx.address,
    //         //     sender: admin.address,
    //         //     receiver: app.address,
    //         //     by: admin.address
    //         // });

    //         [currLPBalanceCore, currLPBalanceBank] = await printLPBalances();
    //         expect((await app.calcWithdrawable(admin.address)).toString()).to.be.closeTo(currLPBalanceBank.add(currLPBalanceCore), parseUnits("1", 18));
    //         expect(await app.calcUserLockedShareAmount(admin.address)).to.be.closeTo(constants.Zero, parseUnits("0.1", 18));
    //     });
});

