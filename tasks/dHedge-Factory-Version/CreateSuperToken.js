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

    const chainId = await getChainId();

    let host;
    switch (chainId) {
      case "80001":
        host = await ethers.getContractAt(
          hostABI,
          "0xEB796bdb90fFA0f28255275e16936D25d3418603"
        );

        break;
      case "137":
        host = await ethers.getContractAt(
          hostABI,
          "0x3E14dC1b13c488a8d5D310918780c983bD5982E7"
        );

        break;

      default:
        throw Error("Chain Id not supported");
    }

    const superTokenFactoryAddr = await host.getSuperTokenFactory();
    const superTokenFactory = await ethers.getContractAt(
      superTokenFactoryABI,
      superTokenFactoryAddr
    );

    const result = await superTokenFactory.createERC20Wrapper(
      taskArgs.underlying,
      1,
      taskArgs.name,
      taskArgs.symbol
    );

    console.log(
      `New super token created, check polygonscan for tx hash ${result.hash} for more info about the address`
    );
  });
