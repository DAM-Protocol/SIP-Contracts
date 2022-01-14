const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");
const { provider, loadFixture } = waffle;
const { parseUnits } = require("@ethersproject/units");
const SuperfluidSDK = require("@superfluid-finance/sdk-core");
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
const SuperfluidGovernanceBase = require("@superfluid-finance/ethereum-contracts/build/contracts/SuperfluidGovernanceII.json");
const SuperfluidTokenFactory = require("@superfluid-finance/ethereum-contracts/build/contracts/SuperTokenFactoryBase.json");
const { constants } = require("ethers");

describe("dHedgeCore Stream Testing", function () {
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
    let core, DHPT;

    before(async () => {
        [USDCWhale, DAIWhale, DAIWhale2] = await impersonateAccounts([USDCWhaleAddr, DAIWhaleAddr, DAIWhaleAddr2]);
        DAIContract = await ethers.getContractAt("IERC20", DAI.token);
        USDCContract = await ethers.getContractAt("IERC20", USDC.token);

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

    });

    async function deployContracts() {
        regKey = await createSFRegistrationKey(admin.address);
        dHedgeCoreFactory = await ethers.getContractFactory("dHedgeCore", {
            libraries: {
                SFHelper: SFHelper.address,
                dHedgeHelper: dHedgeHelper.address,
            },
            admin
        });

        core = await dHedgeCoreFactory.deploy(
            Pool1,
            DHPTx.address,
            "20000",
            regKey
        );
        
        await core.deployed();

        await core.addSuperTokenAndIndex(USDC.superToken);
        await core.addSuperTokenAndIndex(DAI.superToken);

        await USDCContract.connect(USDCWhale).approve(USDC.superToken, parseUnits("1000000", 6));
        await DAIContract.connect(DAIWhale).approve(DAI.superToken, parseUnits("1000000", 18));
        await DAIContract.connect(DAIWhale2).approve(DAI.superToken, parseUnits("1000000", 18));

        await USDCx.upgrade({ amount: parseUnits("1000", 18) }).exec(USDCWhale);
        await DAIx.upgrade({ amount: parseUnits("1000", 18) }).exec(DAIWhale);
        await DAIx.upgrade({ amount: parseUnits("1000", 18) }).exec(DAIWhale2);
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
            publisher: core.address,
            indexId: "0",
            providerOrSigner: ethersProvider
        });

        console.log("Index exists: ", response.exist);
        console.log("Total units approved: ", response.totalUnitsApproved);
        console.log("Total units pending: ", response.totalUnitsPending);

        return response;
    }

    async function getUserUnits(superToken, indexId, userAddr) {
        response = await sf.idaV1.getSubscription({
            superToken: superToken,
            publisher: core.address,
            indexId: indexId,
            subscriber: userAddr,
            providerOrSigner: ethersProvider
        });

        console.log("Subscription approved: ", response.approved);
        console.log("Units: ", response.units);
        console.log("Pending distribution: ", response.pendingDistribution);

        return response;
    }

    it("should be able to start/update/terminate streams", async () => {
        await loadFixture(deployContracts);

        userFlowRate = parseUnits("100", 18).div(getBigNumber(3600 * 24 * 30));

        await sf.cfaV1.createFlow({
            superToken: DAI.superToken,
            receiver: core.address,
            flowRate: userFlowRate
        }).exec(DAIWhale);

        await getIndexDetails(DHPTx.address, "0");

        await getUserUnits(DHPTx.address, "0", DAIWhale.address);

        flowRateResponse = await sf.cfaV1.getFlow({
            superToken: DAI.superToken,
            sender: DAIWhale.address,
            receiver: core.address,
            providerOrSigner: ethersProvider
        });

        expect(flowRateResponse.flowRate).to.equal(userFlowRate);

        userFlowRate = parseUnits("50", 18).div(getBigNumber(3600 * 24 * 30));

        await sf.cfaV1.updateFlow({
            superToken: DAI.superToken,
            receiver: core.address,
            flowRate: userFlowRate
        }).exec(DAIWhale);

        await getUserUnits(DHPTx.address, "0", DAIWhale.address);

        flowRateResponse = await sf.cfaV1.getFlow({
            superToken: DAI.superToken,
            sender: DAIWhale.address,
            receiver: core.address,
            providerOrSigner: ethersProvider
        });

        expect(flowRateResponse.flowRate).to.equal(userFlowRate);

        await sf.cfaV1.deleteFlow({
            superToken: DAI.superToken,
            sender: DAIWhale.address,
            receiver: core.address
        }).exec(DAIWhale);

        await getUserUnits(DHPTx.address, "0", DAIWhale.address);

        flowRateResponse = await sf.cfaV1.getFlow({
            superToken: DAI.superToken,
            sender: DAIWhale.address,
            receiver: core.address,
            providerOrSigner: ethersProvider
        });
        
        expect(flowRateResponse.flowRate).to.equal(constants.Zero);
    });
});
