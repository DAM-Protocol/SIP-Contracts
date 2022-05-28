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
const ConstantFlowAgreementV1 = require("@superfluid-finance/ethereum-contracts/build/contracts/ConstantFlowAgreementV1.json");

describe("Upkeep Mock Testing", function () {
  const [admin, DAO, USDCWhale, DAIWhale, DAIWhale2] = provider.getWallets();
  const ethersProvider = provider;

  // const WBTCxAddr = "0x4086eBf75233e8492F1BCDa41C7f2A8288c2fB92";
  // const WBTCAddr = "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6";

  let sf, resolverAddress, superTokenFactory, CFAAddress, CFAV1;
  // let USDCWhale, DAIWhale, DAIWhale2;
  let DAI, USDC, WBTC, DHPT;
  let mockPool, mockPoolFactory;
  let USDCx, DAIx, WBTCx, DHPTx;
  let dHedgeHelper, dHedgeStorage, dHedgeMath, SFHelper;
  let app;

  before(async () => {
    [resolverAddress, CFAAddress, , superTokenFactory] = await deploySuperfluid(
      admin
    );

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
    WBTC = await tokenFactory.deploy("WBTC mock", "WBTC", 8);
    // await DAI.deployed();
    // await USDC.deployed();

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
    WBTCxAddr = await createSuperToken(
      superTokenFactory.address,
      WBTC.address,
      8,
      "Super WBTC",
      "WBTCx"
    );

    DAIx = await sf.loadSuperToken(DAIxAddr);
    USDCx = await sf.loadSuperToken(USDCxAddr);
    WBTCx = await sf.loadSuperToken(WBTCxAddr);

    CFAV1 = await ethers.getContractAt(ConstantFlowAgreementV1.abi, CFAAddress);

    SFHelperFactory = await ethers.getContractFactory("SFHelper");
    SFHelper = await SFHelperFactory.deploy();
    await SFHelper.deployed();

    dHedgeStorageFactory = await ethers.getContractFactory("dHedgeStorage");
    dHedgeStorage = await dHedgeStorageFactory.deploy();
    await dHedgeStorage.deployed();

    dHedgeMathFactory = await ethers.getContractFactory("dHedgeMath", {
      libraries: {
        SFHelper: SFHelper.address,
      },
    });
    dHedgeMath = await dHedgeMathFactory.deploy();
    await dHedgeMath.deployed();

    dHedgeHelperFactory = await ethers.getContractFactory("dHedgeHelper", {
      libraries: {
        SFHelper: SFHelper.address,
        dHedgeMath: dHedgeMath.address,
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
    await mockPool.setIsDepositAsset(WBTC.address, false);
    await mockPool.setDepositAssets([USDC.address, DAI.address]);

    dHedgeCoreCreatorFactory = await ethers.getContractFactory(
      "dHedgeCoreFactory",
      {
        libraries: {
          SFHelper: SFHelper.address,
          dHedgeHelper: dHedgeHelper.address,
          dHedgeMath: dHedgeMath.address,
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

  /**
   * This test is for the function `emergencyCloseStream` in `dHedgeCore` contract.
   * The logic for the function resides in `SFHelper` contract.
   * This function should only close a user's stream if they don't have enough liquidity to
   * last for more than 12 hours.
   * @dev Ideally we would have liked to test for app jail scenario but by design, it shouldn't fail.
   * Maybe we can create a mock contract which can be jailed and then test if this function works ?
   */
  it("Should be able to close a stream if user is low on supertokens", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("9000", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(USDCWhale, [USDC.address, USDCx.address], userFlowRate);

    // Increase time by 29 and a half days.
    await increaseTime(getSeconds(29.5));

    await app.emergencyCloseStream(USDCx.address, USDCWhale.address);

    // result = await app.calcUserUninvested(USDCWhale.address, DAIx.address);
    // console.log("Get flow result: ", result);
  });

  /**
   * This test is for the function `emergencyCloseStream` in `dHedgeCore` contract.
   * The logic for the function resides in `SFHelper` contract.
   * This function should only close a user's stream if they don't have enough liquidity to
   * last for more than 12 hours.
   */
  it("should not close a stream if user has enough supertokens (more than or equal to 12 hours worth)", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("9000", 18).div(getBigNumber(getSeconds(30)));

    // DAIWhale has a balance of 9000 DAIx before start of the stream and after a day of streaming
    // the balance should still be sufficient to last the stream for more than 12 hours
    await startAndSub(DAIWhale, [DAI.address, DAIx.address], userFlowRate);

    // Increase time by a day
    await increaseTime(getSeconds(1));

    await expect(
      app.emergencyCloseStream(DAIx.address, DAIWhale.address)
    ).to.be.revertedWith("SFHelper: No emergency close");
  });

  it("should return correct token(s) to deposit (requireUpkeep)", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    // result = await app.calcUserUninvested(DAIWhale.address, DAIx.address);
    // console.log("Get flow result: ", result);

    // result = await CFAV1.getFlow(DAIx.address`, DAIWhale.address, app.address);
    // console.log("Get flow result: ", result);`

    await startAndSub(DAIWhale, [DAI.address, DAIx.address], userFlowRate);

    // Increase time by a day
    await increaseTime(getSeconds(1));

    token1 = await app.requireUpkeep();

    expect(token1).to.equal(DAI.address);

    await app.dHedgeDeposit(token1);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    await startAndSub(USDCWhale, [USDC.address, USDCx.address], userFlowRate);

    await increaseTime(getSeconds(1));

    token2 = await app.requireUpkeep();

    await mockPool.setExitRemainingCooldown(app.address, "0");
    await app.dHedgeDeposit(token2);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    token3 = await app.requireUpkeep();

    expect(token2).to.not.equal(token3);

    await mockPool.setExitRemainingCooldown(app.address, "0");
    await app.dHedgeDeposit(token3);
    await mockPool.setExitRemainingCooldown(app.address, getSeconds(1));

    token4 = await app.requireUpkeep();

    expect(token4).to.equal(constants.AddressZero);

    await increaseTime(getSeconds(1));

    await app.deactivateCore("Testing");

    token5 = await app.requireUpkeep();

    expect(token5).to.equal(constants.AddressZero);
  });
});
