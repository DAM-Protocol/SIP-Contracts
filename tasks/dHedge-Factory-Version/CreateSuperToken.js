// const SuperfluidSDK = require("@superfluid-finance/sdk-core");
const { task } = require("hardhat/config");

task(
  "CreateSuperToken",
  "Creates a new supertoken for an underlying ERC20 token"
)
  .addParam(
    "underlying",
    "ERC20 token address for the supertoken's underlying token"
  )
  .addParam("name", "Descriptive name of the supertoken")
  .addParam("symbol", "Symbol of the new supertoken")
  .setAction(async (taskArgs) => {
    const hostABI = [
      "function getGovernance() external view returns (address)",
      "function getSuperTokenFactory() external view returns(address)",
    ];
    const superTokenFactoryABI = [
      "function createERC20Wrapper(address, uint8, string, string) external returns(address)",
      "event SuperTokenCreated(address indexed token)",
    ];

    const host = await ethers.getContractAt(
      hostABI,
      "0x3E14dC1b13c488a8d5D310918780c983bD5982E7"
    );
    const superTokenFactoryAddr = await host.getSuperTokenFactory();
    const superTokenFactory = await ethers.getContractAt(
      superTokenFactoryABI,
      superTokenFactoryAddr
    );

    await superTokenFactory.createERC20Wrapper(
      taskArgs.underlying,
      1,
      taskArgs.name,
      taskArgs.symbol
    );

    const superTokenFilter =
      await superTokenFactory.filters.SuperTokenCreated();

    const response = await superTokenFactory.queryFilter(
      superTokenFilter,
      -1,
      "latest"
    );

    console.log(
      `New supertoken address for token ${taskArgs.name} with symbol ${taskArgs.symbol}: ${response[0].args[0]}`
    );
    // return response[0].args[0];
  });
