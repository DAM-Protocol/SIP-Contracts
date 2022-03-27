/* eslint-disable no-undef */
/* eslint-disable node/no-extraneous-require */
const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");
const { provider, loadFixture } = waffle;
const { parseUnits } = require("@ethersproject/units");
const SuperfluidSDK = require("@superfluid-finance/sdk-core");
const SuperfluidGovernanceBase = require("@superfluid-finance/ethereum-contracts/build/contracts/SuperfluidGovernanceII.json");
const dHEDGEPoolFactory = require("../../helpers/PoolFactoryABI.json");
const {
  getBigNumber,
  getSeconds,
  increaseTime,
  impersonateAccounts,
} = require("../../helpers/helpers");
const { constants } = require("ethers");

describe("3-Index Approach Testing", function () {
  const DAI = {
    token: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    superToken: "0x1305f6b6df9dc47159d12eb7ac2804d4a33173c2",
    decimals: 18,
  };
  const USDC = {
    token: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    superToken: "0xcaa7349cea390f89641fe306d93591f87595dc1f",
    decimals: 6,
  };
  const SFConfig = {
    hostAddress: "0x3E14dC1b13c488a8d5D310918780c983bD5982E7",
    CFAv1: "0x6EeE6060f715257b970700bc2656De21dEdF074C",
    IDAv1: "0xB0aABBA4B2783A72C52956CDEF62d438ecA2d7a1",
  };

  const hostABI = [
    "function getGovernance() external view returns (address)",
    "function getSuperTokenFactory() external view returns(address)",
  ];

  const USDCWhaleAddr = "0x947d711c25220d8301c087b25ba111fe8cbf6672";
  const DAIWhaleAddr = "0x85fcd7dd0a1e1a9fcd5fd886ed522de8221c3ee5";
  const DAIWhaleAddr2 = "0x4A35582a710E1F4b2030A3F826DA20BfB6703C09";

  // dHEDGE Stablecoin Yield (https://app.dhedge.org/pool/0xbae28251b2a4e621aa7e20538c06dee010bc06de)
  // Supports DAI and USDC
  const Pool1 = "0xbae28251b2a4e621aa7e20538c06dee010bc06de";

  // SNX Debt Mirror (https://app.dhedge.org/pool/0x65bb99e80a863e0e27ee6d09c794ed8c0be47186)
  // Supports USDC only

  const [admin, DAO] = provider.getWallets();
  const ethersProvider = provider;

  let sf, host;
  let USDCWhale, DAIWhale, DAIWhale2;
  let DAIContract, USDCContract;
  let USDCx, DAIx, DHPTx;
  let dHedgeHelper, dHedgeStorage, SFHelper;
  let app;

  before(async () => {
    [USDCWhale, DAIWhale, DAIWhale2, dHEDGEOwner] = await impersonateAccounts([
      USDCWhaleAddr,
      DAIWhaleAddr,
      DAIWhaleAddr2,
      "0xc715Aa67866A2FEF297B12Cb26E953481AeD2df4",
    ]);
    DAIContract = await ethers.getContractAt("IERC20", DAI.token);
    USDCContract = await ethers.getContractAt("IERC20", USDC.token);

    sf = await SuperfluidSDK.Framework.create({
      networkName: "hardhat",
      dataMode: "WEB3_ONLY",
      resolverAddress: "0xE0cc76334405EE8b39213E620587d815967af39C", // Polygon mainnet resolver
      protocolReleaseVersion: "v1",
      provider: ethersProvider,
    });

    host = await ethers.getContractAt(hostABI, SFConfig.hostAddress);

    USDCx = await sf.loadSuperToken(USDC.superToken);
    DAIx = await sf.loadSuperToken(DAI.superToken);

    DHPTxAddr = await createSuperToken(Pool1);
    DHPTx = await sf.loadSuperToken(DHPTxAddr);
    DHPT = await ethers.getContractAt("IERC20", Pool1);

    SFHelperFactory = await ethers.getContractFactory("SFHelper");
    SFHelper = await SFHelperFactory.deploy();
    await SFHelper.deployed();

    dHedgeStorageFactory = await ethers.getContractFactory("dHedgeStorage");
    dHedgeStorage = await dHedgeStorageFactory.deploy();
    await dHedgeStorage.deployed();

    dHedgeHelperFactory = await ethers.getContractFactory("dHedgeHelper", {
      libraries: {
        SFHelper: SFHelper.address,
      },
    });
    dHedgeHelper = await dHedgeHelperFactory.deploy();
    await dHedgeHelper.deployed();

    AssetHandlerABI = [
      "function setChainlinkTimeout(uint256) external",
      "function owner() external view returns (address)",
    ];

    AssetHandlerContract = await ethers.getContractAt(
      AssetHandlerABI,
      "0x760FE3179c8491f4b75b21A81F3eE4a5D616A28a"
    );
    await AssetHandlerContract.connect(dHEDGEOwner).setChainlinkTimeout(
      getSeconds(500).toString()
    );

    PoolFactoryContract = await ethers.getContractAt(
      JSON.parse(dHEDGEPoolFactory.result),
      "0xfdc7b8bFe0DD3513Cc669bB8d601Cb83e2F69cB0"
    );
  });

  async function setupEnv() {
    dHedgeCoreCreatorFactory = await ethers.getContractFactory(
      "dHedgeCoreFactory",
      {
        libraries: {
          SFHelper: SFHelper.address,
          dHedgeHelper: dHedgeHelper.address,
        },
        admin,
      }
    );
    factory = await dHedgeCoreCreatorFactory.deploy(DAO.address, "20000");

    await factory.deployed();
    await registerAppByFactory(factory.address);

    await factory.createdHedgeCore(Pool1, DHPTx.address);

    newCore = await factory.cores(Pool1);

    app = await ethers.getContractAt("dHedgeCore", newCore);

    await app.initStreamToken(USDC.superToken);
    await app.initStreamToken(DAI.superToken);

    await approveAndUpgrade();
  }

  async function createSuperToken(underlyingAddress) {
    superTokenFactoryABI = [
      "function createERC20Wrapper(address, uint8, string, string) external returns(address)",
      "event SuperTokenCreated(address indexed token)",
    ];
    superTokenFactoryAddr = await host.getSuperTokenFactory();
    superTokenFactory = await ethers.getContractAt(
      superTokenFactoryABI,
      superTokenFactoryAddr,
      admin
    );

    await superTokenFactory.createERC20Wrapper(
      underlyingAddress,
      1,
      "dHEDGE Stablecoin Yield",
      "dUSDx"
    );
    superTokenFilter = await superTokenFactory.filters.SuperTokenCreated();
    response = await superTokenFactory.queryFilter(
      superTokenFilter,
      -1,
      "latest"
    );

    return response[0].args[0];
  }

  async function approveAndUpgrade() {
    await USDCContract.connect(USDCWhale).approve(
      USDC.superToken,
      parseUnits("1000000", 6)
    );
    await DAIContract.connect(DAIWhale).approve(
      DAI.superToken,
      parseUnits("1000000", 18)
    );
    await DAIContract.connect(DAIWhale2).approve(
      DAI.superToken,
      parseUnits("1000000", 18)
    );

    await USDCx.upgrade({ amount: parseUnits("10000", 18) }).exec(USDCWhale);
    await DAIx.upgrade({ amount: parseUnits("10000", 18) }).exec(DAIWhale);
    await DAIx.upgrade({ amount: parseUnits("10000", 18) }).exec(DAIWhale2);

    await USDCx.transfer({
      receiver: admin.address,
      amount: parseUnits("1000", 18),
    }).exec(USDCWhale);

    await DAIx.transfer({
      receiver: admin.address,
      amount: parseUnits("1000", 18),
    }).exec(DAIWhale);

    await USDCx.approve({
      receiver: app.address,
      amount: parseUnits("1000", 18),
    }).exec(USDCWhale);

    await DAIx.approve({
      receiver: app.address,
      amount: parseUnits("1000", 18),
    }).exec(DAIWhale);

    await DAIx.approve({
      receiver: app.address,
      amount: parseUnits("1000", 18),
    }).exec(DAIWhale2);

    await USDCx.approve({
      receiver: app.address,
      amount: parseUnits("1000", 18),
    }).exec(admin);

    await DAIx.approve({
      receiver: app.address,
      amount: parseUnits("1000", 18),
    }).exec(admin);
  }

  async function startAndSub(wallet, tokenObj, userFlowRate) {
    createFlowOp = sf.cfaV1.createFlow({
      superToken: tokenObj.superToken,
      receiver: app.address,
      flowRate: userFlowRate,
    });

    tokenDistObj = await app.getTokenDistIndices(tokenObj.token);

    tokenDistIndex =
      tokenDistObj[3] === tokenDistObj[0] ? tokenDistObj[1] : tokenDistObj[0];

    // console.log("Token Dist Obj: ", tokenDistObj);
    // console.log("Token dist index: ", tokenDistIndex);

    approveOp = sf.idaV1.approveSubscription({
      indexId: tokenDistIndex,
      superToken: DHPTx.address,
      publisher: app.address,
    });

    await sf.batchCall([createFlowOp, approveOp]).exec(wallet);
  }

  async function registerAppByFactory(factoryAddr) {
    governance = await host.getGovernance();

    sfGovernanceRO = await ethers.getContractAt(
      SuperfluidGovernanceBase.abi,
      governance
    );

    govOwner = await sfGovernanceRO.owner();
    [govOwnerSigner] = await impersonateAccounts([govOwner]);

    sfGovernance = await ethers.getContractAt(
      SuperfluidGovernanceBase.abi,
      governance,
      govOwnerSigner
    );

    await sfGovernance.authorizeAppFactory(SFConfig.hostAddress, factoryAddr);
  }

  async function printDHPTxBalance(accountAddr) {
    currDHPTxBal = await DHPTx.balanceOf({
      account: accountAddr,
      providerOrSigner: ethersProvider,
    });

    console.log(`Current DHPTx balance of ${accountAddr}: ${currDHPTxBal}`);

    return currDHPTxBal;
  }

  it("Should assign correct indices", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(USDCWhale, USDC, userFlowRate);

    USDCWhaleRes = await sf.idaV1.getSubscription({
      superToken: DHPTx.address,
      publisher: app.address,
      indexId: 1,
      subscriber: USDCWhaleAddr,
      providerOrSigner: provider,
    });

    expect(USDCWhaleRes.exist).to.equal(true);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.token);

    expect(tokenDistIndexObj[3]).to.equal(1);

    await startAndSub(admin, USDC, userFlowRate);

    adminRes = await sf.idaV1.getSubscription({
      superToken: DHPTx.address,
      publisher: app.address,
      indexId: 2,
      subscriber: admin.address,
      providerOrSigner: provider,
    });

    expect(adminRes.exist).to.equal(true);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDC.superToken,
        sender: USDCWhaleAddr,
        receiver: app.address,
      })
      .exec(USDCWhale);

    USDCWhaleRes = await sf.idaV1.getSubscription({
      superToken: DHPTx.address,
      publisher: app.address,
      indexId: 1,
      subscriber: USDCWhaleAddr,
      providerOrSigner: provider,
    });

    expect(USDCWhaleRes.exist).to.equal(false);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.token);

    USDCWhaleRes = await sf.idaV1.getSubscription({
      superToken: DHPTx.address,
      publisher: app.address,
      indexId: tokenDistIndexObj[2],
      subscriber: USDCWhaleAddr,
      providerOrSigner: provider,
    });

    expect(USDCWhaleRes.exist).to.equal(true);
  });

  it("Should lock expected indices", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(USDCWhale, USDC, userFlowRate);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.token);

    expect(tokenDistIndexObj[0]).to.equal(1);
    expect(tokenDistIndexObj[1]).to.equal(2);
    expect(tokenDistIndexObj[3]).to.equal(2);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.token);

    expect(tokenDistIndexObj[3]).to.equal(1);

    await startAndSub(admin, USDC, userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.token);

    expect(tokenDistIndexObj[3]).to.equal(2);
  });

  /**
   * This test is for the same function as the above test.
   * @dev In this test we are also triggering dHedge deposit and then checking whether the function works
   * as expected.
   * Note: This test is different in that we are gonna check for different users in different indices (3-index approach)
   */
  it("Should be able to calculate uninvested amount correctly (with deposits)", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(USDCWhale, USDC, userFlowRate);

    whaleDistIndex = await app.getUserDistIndex(USDCWhale.address);

    expect(whaleDistIndex).to.equal(1);

    // Increase time by a day
    await increaseTime(getSeconds(1));

    // Make a deposit to the dHedge pool
    await app.dHedgeDeposit(USDCContract.address);

    // Increase time by a day again
    await increaseTime(getSeconds(1));

    currUninvestedWhale = await app.calcUserUninvested(
      USDCWhale.address,
      USDCContract.address
    );

    // We expect the uninvested amount to equal streamed amount after deposit was made
    // Since we streamed for one day after the deposit, expected is 3 USDCx (@ 90 USDCx/mo)
    expect(currUninvested).to.be.closeTo(
      parseUnits("3", 18),
      parseUnits("1", 18)
    );

    await startAndSub(admin, USDC, userFlowRate);

    adminDistIndex = await app.getUserDistIndex(admin.address);

    expect(adminDistIndex).to.equal(2);

    await increaseTime(getSeconds(1));

    currUninvestedAdmin = await app.calcUserUninvested(
      admin.address,
      USDCContract.address
    );

    // We expect the uninvested amount to equal streamed amount after deposit was made
    // Since we streamed for one day after the deposit, expected is 3 USDCx (@ 90 USDCx/mo)
    expect(currUninvested).to.be.closeTo(
      parseUnits("3", 18),
      parseUnits("1", 18)
    );

    userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .updateFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(USDCWhale);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDCContract.address);

    await increaseTime(getSeconds(1));

    currUninvested = await app.calcUserUninvested(
      USDCWhale.address,
      USDCContract.address
    );
    // console.log("Current uninvested amount", currUninvested.toString());

    // We expect the uninvested amount to equal streamed amount after deposit was made
    // Since we streamed for one day after the deposit, expected is 2 USDCx (@ 60 USDCx/mo)
    expect(currUninvested).to.be.closeTo(
      parseUnits("2", 18),
      parseUnits("1", 18)
    );

    await sf.cfaV1
      .deleteFlow({
        superToken: USDC.superToken,
        sender: USDCWhale.address,
        receiver: app.address,
      })
      .exec(USDCWhale);

    // We expect the uninvested amount to equal 0 because after termination, the uninvested amount
    // of a user was returned.
    expect(
      await app.calcUserUninvested(USDCWhale.address, USDCContract.address)
    ).to.be.closeTo(constants.Zero, parseUnits("1", 18));

    // This is redundant but has been put in just in case if the stream wasn't really terminated
    // This will probably never happen
    await increaseTime(getSeconds(5));

    userFlowRate = parseUnits("30", 18).div(getBigNumber(3600 * 24 * 30));

    await sf.cfaV1
      .createFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(USDCWhale);

    // We expect the uninvested amount to equal 0 as there wasn't any stream prior to our stream creation.
    expect(
      await app.calcUserUninvested(admin.address, USDCContract.address)
    ).to.be.closeTo(constants.Zero, parseUnits("1", 18));

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDCContract.address);

    await increaseTime(getSeconds(1));

    currUninvested = await app.calcUserUninvested(
      admin.address,
      USDCContract.address
    );
    // console.log("Current uninvested amount", currUninvested.toString());

    // We expect the uninvested amount to equal streamed amount after deposit was made
    // Since we streamed for one day after the deposit, expected is 1 USDCx (@ 30 USDCx/mo)
    expect(currUninvested).to.be.closeTo(
      parseUnits("1", 18),
      parseUnits("1", 18)
    );

    // Note: We have skipped the conditions to be checked for such as updation and termination of streams.
    // It can be written later but isn't really expected to cause a problem now as the prior test takes care of it.
  });

  /**
   * This test is for the same function as the above to two tests.
   * @dev In this test we are streaming multiple tokens by a single account.
   * @dev Deposits are not done in this test.
   * Skipped comments for conditions as they are pretty much similar as in the above two tests
   */
  it("Should be able to calculate uninvested amount correctly (multi-token streaming with no deposits)", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(admin, USDC, userFlowRate);

    await startAndSub(admin, DAI, userFlowRate);

    await increaseTime(getSeconds(30));

    currUninvestedUSDC = await app.calcUserUninvested(
      admin.address,
      USDCContract.address
    );
    currUninvestedDAI = await app.calcUserUninvested(
      admin.address,
      DAIContract.address
    );
    // console.log(
    //   "Current uninvested USDC amount: ",
    //   currUninvestedUSDC.toString()
    // );
    // console.log(
    //   "Current uninvested DAI amount: ",
    //   currUninvestedDAI.toString()
    // );

    expect(currUninvestedUSDC).to.be.closeTo(
      parseUnits("60", 18),
      parseUnits("1", 18)
    );
    expect(currUninvestedDAI).to.be.closeTo(
      parseUnits("60", 18),
      parseUnits("1", 18)
    );

    userFlowRate = parseUnits("20", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .updateFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await sf.cfaV1
      .updateFlow({
        superToken: DAI.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await increaseTime(getSeconds(30));

    currUninvestedUSDC = await app.calcUserUninvested(
      admin.address,
      USDCContract.address
    );
    currUninvestedDAI = await app.calcUserUninvested(
      admin.address,
      DAIContract.address
    );
    // console.log(
    //   "Current uninvested USDC amount: ",
    //   currUninvestedUSDC.toString()
    // );
    // console.log(
    //   "Current uninvested DAI amount: ",
    //   currUninvestedDAI.toString()
    // );

    // We expect the uninvested amount to equal:
    // - the amount of USDCx/DAIx we streamed after updating (in this case 20 USDCx/DAIx) +
    // - the amount of USDCx/DAIx taken as an upfront fee during updation of stream (in this case another 20 USDCx/DAIx)
    expect(currUninvestedUSDC).to.be.closeTo(
      parseUnits("40", 18),
      parseUnits("1", 18)
    );
    expect(currUninvestedDAI).to.be.closeTo(
      parseUnits("40", 18),
      parseUnits("1", 18)
    );

    await sf.cfaV1
      .deleteFlow({
        superToken: USDC.superToken,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    await sf.cfaV1
      .deleteFlow({
        superToken: DAI.superToken,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    await increaseTime(getSeconds(30));

    currUninvestedUSDC = await app.calcUserUninvested(
      admin.address,
      USDCContract.address
    );
    currUninvestedDAI = await app.calcUserUninvested(
      admin.address,
      DAIContract.address
    );
    // console.log(
    //   "Current uninvested USDC amount: ",
    //   currUninvestedUSDC.toString()
    // );
    // console.log(
    //   "Current uninvested DAI amount: ",
    //   currUninvestedDAI.toString()
    // );

    expect(currUninvestedUSDC).to.be.closeTo(
      constants.Zero,
      parseUnits("1", 18)
    );
    expect(currUninvestedDAI).to.be.closeTo(
      constants.Zero,
      parseUnits("1", 18)
    );

    userFlowRate = parseUnits("50", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .createFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await sf.cfaV1
      .createFlow({
        superToken: DAI.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await increaseTime(getSeconds(30));

    currUninvestedUSDC = await app.calcUserUninvested(
      admin.address,
      USDCContract.address
    );
    currUninvestedDAI = await app.calcUserUninvested(
      admin.address,
      DAIContract.address
    );
    // console.log(
    //   "Current uninvested USDC amount: ",
    //   currUninvestedUSDC.toString()
    // );
    // console.log(
    //   "Current uninvested DAI amount: ",
    //   currUninvestedDAI.toString()
    // );

    expect(currUninvestedUSDC).to.be.closeTo(
      parseUnits("200", 18),
      parseUnits("1", 18)
    );
    expect(currUninvestedDAI).to.be.closeTo(
      parseUnits("200", 18),
      parseUnits("1", 18)
    );

    userFlowRate = parseUnits("30", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .updateFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await sf.cfaV1
      .updateFlow({
        superToken: DAI.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await increaseTime(getSeconds(30));

    currUninvestedUSDC = await app.calcUserUninvested(
      admin.address,
      USDCContract.address
    );
    currUninvestedDAI = await app.calcUserUninvested(
      admin.address,
      DAIContract.address
    );
    // console.log(
    //   "Current uninvested USDC amount: ",
    //   currUninvestedUSDC.toString()
    // );
    // console.log(
    //   "Current uninvested DAI amount: ",
    //   currUninvestedDAI.toString()
    // );

    // We expect the uninvested amount to equal:
    // - the amount of USDCx/DAIx we streamed after updating (in this case 30 USDCx) +
    // - the amount of USDCx/DAIx taken as an upfront fee during updation of stream (in this case another 120 USDCx)
    expect(currUninvestedUSDC).to.be.closeTo(
      parseUnits("150", 18),
      parseUnits("1", 18)
    );
    expect(currUninvestedDAI).to.be.closeTo(
      parseUnits("150", 18),
      parseUnits("1", 18)
    );

    await sf.cfaV1
      .deleteFlow({
        superToken: USDC.superToken,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    await sf.cfaV1
      .deleteFlow({
        superToken: DAI.superToken,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    await increaseTime(getSeconds(30));

    currUninvestedUSDC = await app.calcUserUninvested(
      admin.address,
      USDCContract.address
    );
    currUninvestedDAI = await app.calcUserUninvested(
      admin.address,
      DAIContract.address
    );
    // console.log(
    //   "Current uninvested USDC amount: ",
    //   currUninvestedUSDC.toString()
    // );
    // console.log(
    //   "Current uninvested DAI amount: ",
    //   currUninvestedDAI.toString()
    // );

    expect(currUninvestedUSDC).to.be.closeTo(
      constants.Zero,
      parseUnits("1", 18)
    );
    expect(currUninvestedDAI).to.be.closeTo(
      constants.Zero,
      parseUnits("1", 18)
    );
  });

  /**
   * This test is validates if the uninvested amount of a user is being correctly returned after stream updates/termination.
   */
  it("should return uninvested amount after stream updation/termination", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(admin, USDC, userFlowRate);

    await increaseTime(getSeconds(1));

    balanceBefore = await USDCx.balanceOf({
      account: admin.address,
      providerOrSigner: ethersProvider,
    });

    userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .updateFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    balanceAfter = await USDCx.balanceOf({
      account: admin.address,
      providerOrSigner: ethersProvider,
    });

    // We expect the returned amount to equal the upfront fee only (in this case 1 USDCx as we already streamed 3 USDCx)
    // Hence, 1 USDCx is returned (as the updated stream rate is lesser than creation stream rate)
    expect(
      getBigNumber(balanceAfter).sub(getBigNumber(balanceBefore))
    ).to.be.closeTo(parseUnits("1", 18), parseUnits("0.5", 18));

    await increaseTime(getSeconds(1));

    balanceBefore = await USDCx.balanceOf({
      account: admin.address,
      providerOrSigner: ethersProvider,
    });

    await sf.cfaV1
      .deleteFlow({
        superToken: USDC.superToken,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    balanceAfter = await USDCx.balanceOf({
      account: admin.address,
      providerOrSigner: ethersProvider,
    });

    // We expect the returned amount to equal:
    // - the amount of USDCx we streamed after updating and before deleting (in this case 2 USDCx) +
    // - the amount of USDCx given equal to upfront fee during updation of stream (in this case another 2 USDCx)
    expect(
      getBigNumber(balanceAfter).sub(getBigNumber(balanceBefore))
    ).to.be.closeTo(parseUnits("4", 18), parseUnits("0.5", 18));
  });

  /**
   * This function tests whether the DHP tokens have been distributed after deposit.
   * @dev This test requires manual verification. Check for the DHP tokens minted and distributed.
   * - They should ideally match.
   */
  it("Should be able to calculate a user's share correctly (single-token)", async () => {
    await loadFixture(setupEnv);

    console.log("\n--Manual verification required for this test--\n");

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(admin, USDC, userFlowRate);

    await increaseTime(getSeconds(30));

    await app.dHedgeDeposit(USDCContract.address);

    await printDHPTxBalance(admin.address);

    // Ideally, no DHP tokens should be left in the contract
    // although some amount can be left due to rounding errors.
    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("1", 18));

    userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .updateFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await increaseTime(getSeconds(30));

    await app.dHedgeDeposit(USDCContract.address);

    await printDHPTxBalance(admin.address);
    await printDHPTxBalance(app.address);

    // Ideally, no DHP tokens should be left in the contract
    // although some amount can be left due to rounding errors.
    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("1", 18));
  });

  /**
   * This function tests whether the DHP tokens have been distributed after deposit.
   * Same as the above test case but for multiple streams of multiple tokens by a single user.
   * @dev This test requires manual verification. Check for the DHP tokens minted and distributed.
   * - They should ideally match.
   */
  it("Should be able to calculate a user's share correctly (single-user-multi-token)", async () => {
    await loadFixture(setupEnv);

    console.log("\n--Manual verification required for this test--\n");

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(admin, USDC, userFlowRate);
    await startAndSub(admin, DAI, userFlowRate);

    await increaseTime(getSeconds(30));

    await app.dHedgeDeposit(DAIContract.address);
    await app.dHedgeDeposit(USDCContract.address);

    await printDHPTxBalance(admin.address);

    // Ideally, no DHP tokens should be left in the contract
    // although some amount can be left due to rounding errors.
    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("1", 18));

    userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .updateFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await sf.cfaV1
      .updateFlow({
        superToken: DAI.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await increaseTime(getSeconds(30));

    await app.dHedgeDeposit(DAIContract.address);
    await app.dHedgeDeposit(USDCContract.address);

    await printDHPTxBalance(admin.address);

    // Ideally, no DHP tokens should be left in the contract
    // although some amount can be left due to rounding errors.
    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("1", 18));

    // await sf.cfaV1
    //   .deleteFlow({
    //     superToken: USDC.superToken,
    //     sender: admin.address,
    //     receiver: app.address,
    //   })
    //   .exec(admin);

    // await sf.cfaV1
    //   .deleteFlow({
    //     superToken: DAI.superToken,
    //     sender: admin.address,
    //     receiver: app.address,
    //   })
    //   .exec(admin);

    // await increaseTime(getSeconds(30));

    // await app.dHedgeDeposit(DAIContract.address);
    // await app.dHedgeDeposit(USDCContract.address);

    // await printDHPTxBalance(admin.address);
  });

  it("should be able to distribute a user's share correctly (multi-user-single-token)", async () => {
    await loadFixture(setupEnv);

    console.log("\n--Manual verification required for this test--\n");

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(admin, USDC, userFlowRate);
    await startAndSub(USDCWhale, USDC, userFlowRate);

    await increaseTime(getSeconds(30));

    await app.dHedgeDeposit(USDCContract.address);

    await printDHPTxBalance(admin.address);
    await printDHPTxBalance(USDCWhale.address);
    await printDHPTxBalance(app.address);

    await expect(app.distribute(USDC.token)).to.be.reverted;

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);

    await printDHPTxBalance(admin.address);
    await printDHPTxBalance(USDCWhale.address);
    await printDHPTxBalance(app.address);

    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("1", 18));

    userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .updateFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await sf.cfaV1
      .updateFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(USDCWhale);

    await increaseTime(getSeconds(30));

    await app.dHedgeDeposit(USDCContract.address);

    await printDHPTxBalance(admin.address);
    await printDHPTxBalance(USDCWhale.address);
    await printDHPTxBalance(app.address);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);

    await printDHPTxBalance(admin.address);
    await printDHPTxBalance(USDCWhale.address);
    await printDHPTxBalance(app.address);

    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("1", 18));

    await sf.cfaV1
      .deleteFlow({
        superToken: USDC.superToken,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDC.superToken,
        sender: USDCWhale.address,
        receiver: app.address,
      })
      .exec(USDCWhale);

    await printDHPTxBalance(admin.address);
    await printDHPTxBalance(USDCWhale.address);
    await printDHPTxBalance(app.address);
  });

  it("should calculate fees correctly", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("100", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(admin, USDC, userFlowRate);

    await increaseTime(getSeconds(30));

    balanceBefore = await USDCContract.balanceOf(DAO.address);

    await app.dHedgeDeposit(USDCContract.address);

    balanceAfter = await USDCContract.balanceOf(DAO.address);

    expect(balanceAfter.sub(balanceBefore)).to.be.closeTo(
      parseUnits("2", 6),
      parseUnits("0.1", 6)
    );
  });
});
