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

  const [admin, DAO] = provider.getWallets();
  const ethersProvider = provider;

  let sf, host;
  let USDCWhale, DAIWhale, DAIWhale2;
  let DAIContract, USDCContract, DHPT;
  let USDCx, DAIx, DHPTx;
  let dHedgeHelper, dHedgeStorage, SFHelper;
  let app, poolManager;

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

    // PoolLogicABI = [
    //   "function manager() internal view returns (address)",
    //   "function poolManagerLogic() public view returns (address)",
    // ];
    // PoolLogicContract = await ethers.getContractAt(PoolLogicABI, Pool1);
    // poolManagerLogic = await PoolLogicContract.poolManagerLogic();

    // PoolManagerLogicABI = [
    //   "function changeAssets(Asset[] calldata, address[] calldata) external",
    // ];

    // poolManager = await ethers.getContractAt(
    //   PoolManagerLogicABI,
    //   poolManagerLogic
    // );

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

  // async function printDHPTxBalance(accountAddr) {
  //   currDHPTxBal = await DHPTx.balanceOf({
  //     account: accountAddr,
  //     providerOrSigner: ethersProvider,
  //   });

  //   console.log(`Current DHPTx balance of ${accountAddr}: ${currDHPTxBal}`);

  //   return currDHPTxBal;
  // }

  it("Should assign correct indices", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(USDCWhale, USDC, userFlowRate);

    USDCWhaleRes = await sf.idaV1.getSubscription({
      superToken: DHPTx.address,
      publisher: app.address,
      indexId: 1,
      subscriber: USDCWhaleAddr,
      providerOrSigner: ethersProvider,
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
      providerOrSigner: ethersProvider,
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
      providerOrSigner: ethersProvider,
    });

    expect(USDCWhaleRes.exist).to.equal(false);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.token);

    USDCWhaleRes = await sf.idaV1.getSubscription({
      superToken: DHPTx.address,
      publisher: app.address,
      indexId: tokenDistIndexObj[2],
      subscriber: USDCWhaleAddr,
      providerOrSigner: ethersProvider,
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
   * This function tests whether the DHP tokens have been distributed after deposit.
   * @dev This test requires manual verification. Check for the DHP tokens minted and distributed.
   * - They should ideally match.
   */
  it("Should distribute DHPTx correctly (single token with distributions triggered)", async () => {
    await loadFixture(setupEnv);

    console.log("\n--Manual verification required for this test--\n");

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    // The user will now be assigned index 1
    await startAndSub(USDCWhale, USDC, userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDCContract.address);

    DHPTBalance1 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhaleAddr,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance1, parseUnits("0.001", 18));

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);

    DHPTBalance2 = await DHPT.balanceOf(app.address);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.token);

    userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .updateFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(USDCWhale);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObj[1],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(USDCWhale);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObj[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(USDCWhale);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhaleAddr,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance2.add(DHPTBalance1), parseUnits("0.001", 18));

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);

    DHPTBalance3 = await DHPT.balanceOf(app.address);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDC.superToken,
        sender: USDCWhaleAddr,
        receiver: app.address,
      })
      .exec(USDCWhale);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.token);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObj[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(USDCWhale);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhaleAddr,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(
      DHPTBalance3.add(DHPTBalance2.add(DHPTBalance1)),
      parseUnits("0.001", 18)
    );

    // Ideally, no DHP tokens should be left in the contract
    // although some amount can be left due to rounding errors.
    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("0.001", 18));

    expect(await DHPT.balanceOf(app.address)).to.be.closeTo(
      constants.Zero,
      parseUnits("0.001", 18)
    );
  });

  it("Should distribute DHPTx correctly (single token without distributions triggered)", async () => {
    await loadFixture(setupEnv);

    console.log("\n--Manual verification required for this test--\n");

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    // The user will now be assigned index 1
    await startAndSub(USDCWhale, USDC, userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDCContract.address);

    DHPTBalance1 = await DHPT.balanceOf(app.address);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.token);

    await sf.cfaV1
      .updateFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(USDCWhale);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObj[1],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(USDCWhale);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObj[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(USDCWhale);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);

    DHPTBalance2 = await DHPT.balanceOf(app.address);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhaleAddr,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance1, parseUnits("0.001", 18));

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.token);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDC.superToken,
        sender: USDCWhaleAddr,
        receiver: app.address,
      })
      .exec(USDCWhale);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObj[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(USDCWhale);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);

    userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

    expect(
      await DHPTx.balanceOf({
        account: USDCWhaleAddr,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance2.add(DHPTBalance1), parseUnits("0.001", 18));

    // Ideally, no DHP tokens should be left in the contract
    // although some amount can be left due to rounding errors.
    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("0.001", 18));

    expect(await DHPT.balanceOf(app.address)).to.be.closeTo(
      constants.Zero,
      parseUnits("0.001", 18)
    );
  });

  /**
   * This function tests whether the DHP tokens have been distributed after deposit.
   * Same as the above test case but for multiple streams of multiple tokens by a single user.
   * @dev This test requires manual verification. Check for the DHP tokens minted and distributed.
   * - They should ideally match.
   */
  it("Should distribute DHPTx correctly (single user multi token with distributions triggered)", async () => {
    await loadFixture(setupEnv);

    console.log("\n--Manual verification required for this test--\n");

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(admin, USDC, userFlowRate);
    await startAndSub(admin, DAI, userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDCContract.address);
    await app.dHedgeDeposit(DAIContract.address);

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.token);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.token);

    expect(tokenDistIndexObjUSDC[3]).to.equal(1);
    expect(tokenDistIndexObjDAI[3]).to.equal(4);

    DHPTBalance1 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);
    await app.distribute(DAI.token);

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance1, parseUnits("0.001", 18));

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.token);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.token);

    expect(tokenDistIndexObjUSDC[3]).to.equal(1);
    expect(tokenDistIndexObjDAI[3]).to.equal(4);

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

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);
    await app.dHedgeDeposit(DAI.token);

    DHPTBalance2 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);
    await app.distribute(DAI.token);

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance2.add(DHPTBalance1), parseUnits("0.001", 18));

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);
    await app.dHedgeDeposit(DAI.token);

    DHPTBalance3 = await DHPT.balanceOf(app.address);

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

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.token);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.token);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObjUSDC[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(admin);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObjDAI[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(admin);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);
    await app.distribute(DAI.token);

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(
      DHPTBalance3.add(DHPTBalance2.add(DHPTBalance1)),
      parseUnits("0.001", 18)
    );

    // Ideally, no DHP tokens should be left in the contract
    // although some amount can be left due to rounding errors.
    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("0.001", 18));

    expect(await DHPT.balanceOf(app.address)).to.be.closeTo(
      constants.Zero,
      parseUnits("0.001", 18)
    );
  });

  it("Should distribute DHPTx correctly (single user multi token without triggering distributions)", async () => {
    await loadFixture(setupEnv);

    console.log("\n--Manual verification required for this test--\n");

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(admin, USDC, userFlowRate);
    await startAndSub(admin, DAI, userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDCContract.address);
    await app.dHedgeDeposit(DAIContract.address);

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.token);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.token);

    expect(tokenDistIndexObjUSDC[3]).to.equal(1);
    expect(tokenDistIndexObjDAI[3]).to.equal(4);

    DHPTBalance1 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.token);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.token);

    expect(tokenDistIndexObjUSDC[3]).to.equal(1);
    expect(tokenDistIndexObjDAI[3]).to.equal(4);

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

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.token);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.token);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObjUSDC[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(admin);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObjDAI[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(admin);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObjUSDC[1],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(admin);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObjDAI[1],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(admin);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);
    await app.dHedgeDeposit(DAI.token);

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.token);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.token);

    expect(tokenDistIndexObjUSDC[3]).to.equal(2);
    expect(tokenDistIndexObjDAI[3]).to.equal(5);

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance1, parseUnits("0.001", 18));

    DHPTBalance2 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);
    await app.dHedgeDeposit(DAI.token);

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.token);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.token);

    expect(tokenDistIndexObjUSDC[3]).to.equal(2);
    expect(tokenDistIndexObjDAI[3]).to.equal(5);

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance2.add(DHPTBalance1), parseUnits("0.001", 18));

    DHPTBalance3 = await DHPT.balanceOf(app.address);

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

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.token);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.token);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObjUSDC[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(admin);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObjDAI[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(admin);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);
    await app.distribute(DAI.token);

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(
      DHPTBalance3.add(DHPTBalance2.add(DHPTBalance1)),
      parseUnits("0.001", 18)
    );

    // Ideally, no DHP tokens should be left in the contract
    // although some amount can be left due to rounding errors.
    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("0.001", 18));

    expect(await DHPT.balanceOf(app.address)).to.be.closeTo(
      constants.Zero,
      parseUnits("0.001", 18)
    );
  });

  it("should be able to distribute a user's share correctly (multi user single token triggered distributions)", async () => {
    await loadFixture(setupEnv);

    console.log("\n--Manual verification required for this test--\n");

    userFlowRate1 = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));
    userFlowRate2 = parseUnits("45", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(USDCWhale, USDC, userFlowRate1);
    await startAndSub(admin, USDC, userFlowRate2);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDCContract.address);

    DHPTBalance1 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhaleAddr,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(
      DHPTBalance1.mul(getBigNumber(2)).div(getBigNumber(3)),
      parseUnits("0.001", 18)
    );

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance1.div(getBigNumber(3)), parseUnits("0.001", 18));

    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("1", 18));

    userFlowRate1 = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));
    userFlowRate2 = parseUnits("30", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .updateFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate1,
      })
      .exec(USDCWhale);

    await sf.cfaV1
      .updateFlow({
        superToken: USDC.superToken,
        receiver: app.address,
        flowRate: userFlowRate2,
      })
      .exec(admin);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDCContract.address);

    DHPTBalance2 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhaleAddr,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(
      DHPTBalance2.add(DHPTBalance1).mul(getBigNumber(2)).div(getBigNumber(3)),
      parseUnits("0.001", 18)
    );

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(
      DHPTBalance2.add(DHPTBalance1).div(getBigNumber(3)),
      parseUnits("0.001", 18)
    );

    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("1", 18));

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);

    DHPTBalance3 = await DHPT.balanceOf(app.address);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDC.superToken,
        sender: USDCWhale.address,
        receiver: app.address,
      })
      .exec(USDCWhale);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDC.superToken,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.token);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObjUSDC[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(USDCWhale);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObjUSDC[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(admin);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhaleAddr,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(
      DHPTBalance3.add(DHPTBalance2)
        .add(DHPTBalance1)
        .mul(getBigNumber(2))
        .div(getBigNumber(3)),
      parseUnits("0.001", 18)
    );

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(
      DHPTBalance3.add(DHPTBalance2).add(DHPTBalance1).div(getBigNumber(3)),
      parseUnits("0.001", 18)
    );

    expect(
      await DHPTx.balanceOf({
        account: app.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(constants.Zero, parseUnits("1", 18));
  });

  it("should be able to distribute a user's share correctly (after inactivity)", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("100", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(admin, USDC, userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);

    DHPTBalance1 = await DHPT.balanceOf(app.address);

    console.log("DHPT balance in contract: ", DHPTBalance1.toString());

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.token);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDC.superToken,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObjUSDC[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(admin);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance1, parseUnits("0.001", 18));

    await increaseTime(getSeconds(1));

    await startAndSub(admin, USDC, userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.token);

    DHPTBalance2 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    await app.distribute(USDC.token);

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance2.add(DHPTBalance1), parseUnits("0.001", 18));
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
