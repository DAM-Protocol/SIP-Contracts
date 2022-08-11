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

describe("3-Index Approach Revert Mock Testing", function () {
  const [admin, DAO, USDCWhale, DAIWhale, DAIWhale2] = provider.getWallets();
  const ethersProvider = provider;

  // const WBTCxAddr = "0x4086eBf75233e8492F1BCDa41C7f2A8288c2fB92";
  // const WBTCAddr = "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6";

  let sf, resolverAddress, superTokenFactory;
  // let USDCWhale, DAIWhale, DAIWhale2;
  let DAI, USDC, WBTC, DHPT;
  let mockPool, mockPoolFactory;
  let USDCx, DAIx, WBTCx, DHPTx;
  let dHedgeHelper, dHedgeStorage, dHedgeMath, SFHelper;
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

  context("should not re-initialise a supertoken", function () {
    it("if the supertoken is already initialised", async () => {
      await loadFixture(setupEnv);

      await expect(app.initStreamToken(USDCx.address)).to.be.revertedWith(
        "dHedgeHelper: Token already present"
      );
    });

    it("if token is not a deposit asset", async () => {
      await loadFixture(setupEnv);

      await expect(app.initStreamToken(WBTCx.address)).to.be.revertedWith(
        "dHedgeHelper: Not deposit asset"
      );
    });
  });

  context("should not deposit tokens into the dHEDGE pool", function () {
    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    it("if no streams exist", async () => {
      await loadFixture(setupEnv);

      await expect(app.dHedgeDeposit(USDC.address)).to.be.revertedWith(
        "dHedgeHelper: Deposit not required"
      );

      // User starts a stream but terminates it without any deposit taking place.
      // In such a case, no supertokens should be left in the contract corresponding to the user.
      // Hence, no deposit is required.
      await startAndSub(USDCWhale, [USDC.address, USDCx.address], userFlowRate);

      await increaseTime(getSeconds(1));

      await sf.cfaV1
        .deleteFlow({
          superToken: USDCx.address,
          sender: USDCWhale.address,
          receiver: app.address,
        })
        .exec(USDCWhale);

      await expect(app.dHedgeDeposit(USDC.address)).to.be.revertedWith(
        "dHedgeHelper: Deposit not required"
      );
    });

    it("if already deposited", async () => {
      await loadFixture(setupEnv);

      await startAndSub(USDCWhale, [USDC.address, USDCx.address], userFlowRate);

      await increaseTime(getSeconds(1));

      await app.dHedgeDeposit(USDC.address);

      await expect(app.dHedgeDeposit(USDC.address)).to.be.revertedWith(
        "dHedgeHelper: Deposit not required"
      );
    });

    it("should revert if token is not deposit asset", async () => {
      await loadFixture(setupEnv);

      await expect(app.dHedgeDeposit(WBTCx.address)).to.be.revertedWith(
        "dHedgeHelper: Deposit not required"
      );
    });
  });

  context("should not distribute tokens", function () {
    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    it("if no streams exist", async () => {
      await loadFixture(setupEnv);

      await expect(app.distribute(USDC.address)).to.be.revertedWith(
        "dHedgeHelper: No amount to distribute"
      );
    });

    it("if trying to distribute a token twice (single token streaming)", async () => {
      await loadFixture(setupEnv);

      await startAndSub(USDCWhale, [USDC.address, USDCx.address], userFlowRate);

      await increaseTime(getSeconds(1));

      await app.dHedgeDeposit(USDC.address);

      await increaseTime(getSeconds(1));

      await app.distribute(USDC.address);

      await expect(app.distribute(USDC.address)).to.be.revertedWith(
        "dHedgeHelper: No amount to distribute"
      );
    });

    it("if trying to distribute a token twice (multiple tokens streaming)", async () => {
      await loadFixture(setupEnv);

      await startAndSub(admin, [USDC.address, USDCx.address], userFlowRate);
      await startAndSub(admin, [DAI.address, DAIx.address], userFlowRate);

      await increaseTime(getSeconds(1));

      await app.dHedgeDeposit(USDC.address);
      await app.dHedgeDeposit(DAI.address);

      await increaseTime(getSeconds(1));

      await app.distribute(USDC.address);
      await app.distribute(DAI.address);

      await expect(app.distribute(USDC.address)).to.be.revertedWith(
        "dHedgeHelper: No amount to distribute"
      );

      await expect(app.distribute(DAI.address)).to.be.revertedWith(
        "dHedgeHelper: No amount to distribute"
      );
    });

    it("if token is not initialised and not a deposit asset", async () => {
      await loadFixture(setupEnv);

      await expect(app.distribute(WBTC.address)).to.be.revertedWith(
        "dHedgeHelper: No amount to distribute"
      );
    });
  });
});
