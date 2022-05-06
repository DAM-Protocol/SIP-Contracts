/* eslint-disable no-undef */
/* eslint-disable node/no-extraneous-require */
const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");
const { provider, loadFixture } = waffle;
const { parseUnits } = require("@ethersproject/units");
const { Framework } = require("@superfluid-finance/sdk-core");
const { deploySuperfluid } = require("../utils/SFSetup");
const {
  getBigNumber,
  getSeconds,
  increaseTime,
} = require("../../helpers/helpers");
const { constants } = require("ethers");

// const errorHandler = (err) => {
//   if (err) throw err;
// };

describe("3-Index Approach Mock Testing", function () {
  const [admin, DAO, USDCWhale, DAIWhale, DAIWhale2] = provider.getWallets();
  const ethersProvider = provider;

  let sf, resolverAddress, superTokenFactory;
  // let USDCWhale, DAIWhale, DAIWhale2;
  let DAI, USDC, DHPT;
  let mockPool, mockPoolFactory;
  let USDCx, DAIx, DHPTx;
  let dHedgeHelper, dHedgeStorage, SFHelper;
  let app;

  before(async () => {
    [resolverAddress, , , superTokenFactory] = await deploySuperfluid(admin);

    sf = await Framework.create({
      networkName: "hardhat",
      dataMode: "WEB3_ONLY",
      resolverAddress: resolverAddress, // Polygon mainnet resolver
      protocolReleaseVersion: "test",
      provider: ethersProvider,
    });

    tokenFactory = await ethers.getContractFactory("MockERC20", admin);

    DAI = await tokenFactory.deploy("DAI mock", "DAI", 18);
    USDC = await tokenFactory.deploy("USDC mock", "USDC", 6);
    await DAI.deployed();
    await USDC.deployed();
    // DHPT = await tokenFactory.deploy("DHPT Mock", "DHPT", 18);

    console.log("Mock tokens deployed");
    // DHPT = new Contract(DHPTx.underlyingToken.address, "IERC20", admin);

    // mockPool = await deployMockContract(admin, PoolLogic);
    mockPoolFactory = await ethers.getContractFactory("MockdHEDGEPool", admin);

    DAIxAddr = await createSuperToken(
      superTokenFactory.address,
      DAI.address,
      18,
      "Super DAI",
      "DAIx"
    );
    USDCxAddr = await createSuperToken(
      superTokenFactory.address,
      USDC.address,
      6,
      "Super USDC",
      "USDCx"
    );

    DAIx = await sf.loadSuperToken(DAIxAddr);
    USDCx = await sf.loadSuperToken(USDCxAddr);

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
  });

  async function setupEnv() {
    mockPool = await mockPoolFactory.deploy("DHPT Mock", "DHPT", 18);
    await mockPool.deployed();

    DHPT = mockPool;

    DHPTxAddr = await createSuperToken(
      superTokenFactory.address,
      mockPool.address,
      18,
      "Mock DHPT",
      "DHPTx"
    );

    DHPTx = await sf.loadSuperToken(DHPTxAddr);

    await mockPool.setIsDepositAsset(USDC.address, true);
    await mockPool.setIsDepositAsset(DAI.address, true);
    await mockPool.setDepositAssets([USDC.address, DAI.address]);

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
    // await registerAppByFactory(factory.address);

    // await mockPool.mock.increaseAllowance.returns(true);
    await factory.createdHedgeCore(mockPool.address, DHPTx.address);

    newCore = await factory.cores(mockPool.address);

    app = await ethers.getContractAt("dHedgeCore", newCore);

    await app.initStreamToken(USDCx.address);
    await app.initStreamToken(DAIx.address);

    await approveAndUpgrade();
  }

  async function createSuperToken(
    superTokenFactoryAddr,
    underlyingAddress,
    decimals,
    name,
    symbol
  ) {
    superTokenFactoryABI = [
      "function createERC20Wrapper(address, uint8, uint8, string, string) external returns(address)",
      "event SuperTokenCreated(address indexed token)",
    ];
    // superTokenFactoryAddr = await host.getSuperTokenFactory();
    superTokenFactory = await ethers.getContractAt(
      superTokenFactoryABI,
      superTokenFactoryAddr,
      admin
    );

    await superTokenFactory.createERC20Wrapper(
      underlyingAddress,
      decimals,
      1,
      name,
      symbol
    );

    superTokenFilter = superTokenFactory.filters.SuperTokenCreated();
    response = await superTokenFactory.queryFilter(
      superTokenFilter,
      "latest",
      "latest"
    );

    return response[0].args[0];
  }

  async function approveAndUpgrade() {
    await USDC.mint(USDCWhale.address, parseUnits("1000000", 6));
    await DAI.mint(DAIWhale.address, parseUnits("1000000", 18));
    await DAI.mint(DAIWhale2.address, parseUnits("1000000", 18));

    await USDC.connect(USDCWhale).approve(
      USDCx.address,
      parseUnits("100000", 6)
    );
    await DAI.connect(DAIWhale).approve(DAIx.address, parseUnits("100000", 18));
    await DAI.connect(DAIWhale2).approve(
      DAIx.address,
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
      superToken: tokenObj[1],
      receiver: app.address,
      flowRate: userFlowRate,
    });

    tokenDistObj = await app.getTokenDistIndices(tokenObj[0]);

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

  it("Should assign correct indices", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(USDCWhale, [USDC.address, USDCx.address], userFlowRate);

    USDCWhaleRes = await sf.idaV1.getSubscription({
      superToken: DHPTx.address,
      publisher: app.address,
      indexId: 1,
      subscriber: USDCWhale.address,
      providerOrSigner: ethersProvider,
    });

    expect(USDCWhaleRes.exist).to.equal(true);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);

    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.address);

    expect(tokenDistIndexObj[3]).to.equal(1);

    await startAndSub(admin, [USDC.address, USDCx.address], userFlowRate);

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
        superToken: USDCx.address,
        sender: USDCWhale.address,
        receiver: app.address,
      })
      .exec(USDCWhale);

    USDCWhaleRes = await sf.idaV1.getSubscription({
      superToken: DHPTx.address,
      publisher: app.address,
      indexId: 1,
      subscriber: USDCWhale.address,
      providerOrSigner: ethersProvider,
    });

    expect(USDCWhaleRes.exist).to.equal(false);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.address);

    USDCWhaleRes = await sf.idaV1.getSubscription({
      superToken: DHPTx.address,
      publisher: app.address,
      indexId: tokenDistIndexObj[2],
      subscriber: USDCWhale.address,
      providerOrSigner: ethersProvider,
    });

    expect(USDCWhaleRes.exist).to.equal(true);

    await increaseTime(getSeconds(1));

    await mockPool.setExitRemainingCooldown(app.address, constants.Zero);

    await app.distribute(USDC.address);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDCx.address,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    adminRes = await sf.idaV1.getSubscription({
      superToken: DHPTx.address,
      publisher: app.address,
      indexId: 2,
      subscriber: admin.address,
      providerOrSigner: ethersProvider,
    });

    expect(adminRes.exist).to.equal(false);

    await startAndSub(USDCWhale, [USDC.address, USDCx.address], userFlowRate);

    USDCWhaleRes = await sf.idaV1.getSubscription({
      superToken: DHPTx.address,
      publisher: app.address,
      indexId: 2,
      subscriber: USDCWhale.address,
      providerOrSigner: ethersProvider,
    });

    expect(USDCWhaleRes.exist).to.equal(true);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);

    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.address);

    expect(tokenDistIndexObj[3]).to.equal(2);

    await increaseTime(getSeconds(1));

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.distribute(USDC.address);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDCx.address,
        sender: USDCWhale.address,
        receiver: app.address,
      })
      .exec(USDCWhale);

    USDCWhaleRes = await sf.idaV1.getSubscription({
      superToken: DHPTx.address,
      publisher: app.address,
      indexId: 2,
      subscriber: USDCWhale.address,
      providerOrSigner: ethersProvider,
    });

    expect(USDCWhaleRes.exist).to.equal(false);
  });

  it("Should lock expected indices", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(USDCWhale, [USDC.address, USDCx.address], userFlowRate);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.address);

    expect(tokenDistIndexObj[0]).to.equal(1);
    expect(tokenDistIndexObj[1]).to.equal(2);
    expect(tokenDistIndexObj[3]).to.equal(2);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);

    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.address);

    expect(tokenDistIndexObj[3]).to.equal(1);

    await startAndSub(admin, [USDC.address, USDCx.address], userFlowRate);

    await increaseTime(getSeconds(1));

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.dHedgeDeposit(USDC.address);

    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.address);

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
    await startAndSub(USDCWhale, [USDC.address, USDCx.address], userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);

    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance1 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.distribute(USDC.address);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhale.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance1, parseUnits("0.001", 18));

    // await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);

    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance2 = await DHPT.balanceOf(app.address);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.address);

    userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .updateFlow({
        superToken: USDCx.address,
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

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.distribute(USDC.address);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhale.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance2.add(DHPTBalance1), parseUnits("0.001", 18));

    // await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);

    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance3 = await DHPT.balanceOf(app.address);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDCx.address,
        sender: USDCWhale.address,
        receiver: app.address,
      })
      .exec(USDCWhale);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.address);

    await sf.idaV1
      .approveSubscription({
        indexId: tokenDistIndexObj[2],
        superToken: DHPTx.address,
        publisher: app.address,
      })
      .exec(USDCWhale);

    await increaseTime(getSeconds(1));

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.distribute(USDC.address);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhale.address,
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
    await startAndSub(USDCWhale, [USDC.address, USDCx.address], userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);

    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance1 = await DHPT.balanceOf(app.address);

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.address);

    await sf.cfaV1
      .updateFlow({
        superToken: USDCx.address,
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

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.dHedgeDeposit(USDC.address);

    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance2 = await DHPT.balanceOf(app.address);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhale.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance1, parseUnits("0.001", 18));

    tokenDistIndexObj = await app.getTokenDistIndices(USDC.address);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDCx.address,
        sender: USDCWhale.address,
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

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.distribute(USDC.address);

    userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

    expect(
      await DHPTx.balanceOf({
        account: USDCWhale.address,
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

    await startAndSub(admin, [USDC.address, USDCx.address], userFlowRate);
    await startAndSub(admin, [DAI.address, DAIx.address], userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    await app.dHedgeDeposit(DAI.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance1 = await DHPT.balanceOf(app.address);
    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.address);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.address);

    expect(tokenDistIndexObjUSDC[3]).to.equal(1);
    expect(tokenDistIndexObjDAI[3]).to.equal(4);

    await increaseTime(getSeconds(1));

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.distribute(USDC.address);
    await app.distribute(DAI.address);

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance1, parseUnits("0.001", 18));

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.address);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.address);

    expect(tokenDistIndexObjUSDC[3]).to.equal(1);
    expect(tokenDistIndexObjDAI[3]).to.equal(4);

    userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .updateFlow({
        superToken: USDCx.address,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await sf.cfaV1
      .updateFlow({
        superToken: DAIx.address,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    await app.dHedgeDeposit(DAI.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance2 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.distribute(USDC.address);
    await app.distribute(DAI.address);

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance2.add(DHPTBalance1), parseUnits("0.001", 18));

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));
    await app.dHedgeDeposit(DAI.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance3 = await DHPT.balanceOf(app.address);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDCx.address,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    await sf.cfaV1
      .deleteFlow({
        superToken: DAIx.address,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.address);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.address);

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

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.distribute(USDC.address);
    await app.distribute(DAI.address);

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

    await startAndSub(admin, [USDC.address, USDCx.address], userFlowRate);
    await startAndSub(admin, [DAI.address, DAIx.address], userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));
    await app.dHedgeDeposit(DAI.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.address);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.address);

    expect(tokenDistIndexObjUSDC[3]).to.equal(1);
    expect(tokenDistIndexObjDAI[3]).to.equal(4);

    DHPTBalance1 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.address);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.address);

    expect(tokenDistIndexObjUSDC[3]).to.equal(1);
    expect(tokenDistIndexObjDAI[3]).to.equal(4);

    userFlowRate = parseUnits("60", 18).div(getBigNumber(getSeconds(30)));

    await sf.cfaV1
      .updateFlow({
        superToken: USDCx.address,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    await sf.cfaV1
      .updateFlow({
        superToken: DAIx.address,
        receiver: app.address,
        flowRate: userFlowRate,
      })
      .exec(admin);

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.address);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.address);

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

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.dHedgeDeposit(USDC.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));
    await app.dHedgeDeposit(DAI.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.address);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.address);

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

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.dHedgeDeposit(USDC.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));
    await app.dHedgeDeposit(DAI.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.address);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.address);

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
        superToken: USDCx.address,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    await sf.cfaV1
      .deleteFlow({
        superToken: DAIx.address,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.address);
    tokenDistIndexObjDAI = await app.getTokenDistIndices(DAI.address);

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

    await mockPool.setExitRemainingCooldown(app.address, "0");

    await app.distribute(USDC.address);
    await app.distribute(DAI.address);

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

    await startAndSub(USDCWhale, [USDC.address, USDCx.address], userFlowRate1);
    await startAndSub(admin, [USDC.address, USDCx.address], userFlowRate2);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance1 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    await mockPool.setExitRemainingCooldown(app.address, "0");
    await app.distribute(USDC.address);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhale.address,
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
        superToken: USDCx.address,
        receiver: app.address,
        flowRate: userFlowRate1,
      })
      .exec(USDCWhale);

    await sf.cfaV1
      .updateFlow({
        superToken: USDCx.address,
        receiver: app.address,
        flowRate: userFlowRate2,
      })
      .exec(admin);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance2 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    await mockPool.setExitRemainingCooldown(app.address, "0");
    await app.distribute(USDC.address);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhale.address,
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

    await app.dHedgeDeposit(USDC.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance3 = await DHPT.balanceOf(app.address);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDCx.address,
        sender: USDCWhale.address,
        receiver: app.address,
      })
      .exec(USDCWhale);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDCx.address,
        sender: admin.address,
        receiver: app.address,
      })
      .exec(admin);

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.address);

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

    await mockPool.setExitRemainingCooldown(app.address, "0");
    await app.distribute(USDC.address);

    expect(
      await DHPTx.balanceOf({
        account: USDCWhale.address,
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

    await startAndSub(admin, [USDC.address, USDCx.address], userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance1 = await DHPT.balanceOf(app.address);

    // console.log("DHPT balance in contract: ", DHPTBalance1.toString());

    tokenDistIndexObjUSDC = await app.getTokenDistIndices(USDC.address);

    await sf.cfaV1
      .deleteFlow({
        superToken: USDCx.address,
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

    await mockPool.setExitRemainingCooldown(app.address, "0");
    await app.distribute(USDC.address);

    expect(
      await DHPTx.balanceOf({
        account: admin.address,
        providerOrSigner: ethersProvider,
      })
    ).to.be.closeTo(DHPTBalance1, parseUnits("0.001", 18));

    await increaseTime(getSeconds(1));

    await startAndSub(admin, [USDC.address, USDCx.address], userFlowRate);

    await increaseTime(getSeconds(1));

    await app.dHedgeDeposit(USDC.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    DHPTBalance2 = await DHPT.balanceOf(app.address);

    await increaseTime(getSeconds(1));

    await mockPool.setExitRemainingCooldown(app.address, "0");
    await app.distribute(USDC.address);

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

    await startAndSub(admin, [USDC.address, USDCx.address], userFlowRate);

    await increaseTime(getSeconds(30));

    balanceBefore = await USDC.balanceOf(DAO.address);

    await app.dHedgeDeposit(USDC.address);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    balanceAfter = await USDC.balanceOf(DAO.address);

    expect(balanceAfter.sub(balanceBefore)).to.be.closeTo(
      parseUnits("2", 6),
      parseUnits("0.1", 6)
    );
  });
});
