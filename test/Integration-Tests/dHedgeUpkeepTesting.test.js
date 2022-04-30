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

describe("Upkeep Testing", function () {
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

    await startAndSub(USDCWhale, USDC, userFlowRate);

    // Increase time by 29 and a half days.
    await increaseTime(getSeconds(29.5));
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
    await startAndSub(DAIWhale, DAI, userFlowRate);

    // Increase time by a day
    await increaseTime(getSeconds(1));

    await expect(
      app.emergencyCloseStream(DAI.superToken, DAIWhale.address)
    ).to.be.revertedWith("SFHelper: No emergency close");
  });

  it("should return correct token(s) to deposit (requireUpkeep)", async () => {
    await loadFixture(setupEnv);

    userFlowRate = parseUnits("90", 18).div(getBigNumber(getSeconds(30)));

    await startAndSub(DAIWhale, DAI, userFlowRate);

    // Increase time by a day
    await increaseTime(getSeconds(1));

    token1 = await app.requireUpkeep();

    expect(token1).to.equal(DAI.token);

    await app.dHedgeDeposit(token1);

    await startAndSub(USDCWhale, USDC, userFlowRate);

    await increaseTime(getSeconds(1));

    token2 = await app.requireUpkeep();

    await app.dHedgeDeposit(token2);

    token3 = await app.requireUpkeep();

    expect(token2).to.not.equal(token3);

    await app.dHedgeDeposit(token3);

    token4 = await app.requireUpkeep();

    expect(token4).to.equal(constants.AddressZero);

    await increaseTime(getSeconds(1));

    await app.deactivateCore("Testing");

    token5 = await app.requireUpkeep();

    expect(token5).to.equal(constants.AddressZero);
  });
});
