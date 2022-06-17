require("dotenv").config();
require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-web3");
require("hardhat-gas-reporter");
require("solidity-coverage");
require("hardhat-contract-sizer");
require("hardhat-tracer");
require("hardhat-deploy");
require("hardhat-erc1820");
require("./tasks/dHedge-Factory-Version/CreateSIP");
require("./tasks/dHedge-Factory-Version/CreateSuperToken");
require("./tasks/dHedge-Factory-Version/PauseCore");
require("./tasks/dHedge-Factory-Version/DeactivateCore");
require("./tasks/dHedge-Factory-Version/CreateMockPool");

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.8.13",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      initialBaseFeePerGas: 0, // workaround from https://github.com/sc-forks/solidity-coverage/issues/652#issuecomment-896330136 . Remove when that issue is closed.
      forking: {
        url: process.env.POLYGON_NODE_URL,
        // blockNumber: 23736635,
        blockNumber: 25295628,
        enabled: false,
      },
      // accounts: [{privateKey: `0x${process.env.MAINNET_PRIVATE_KEY}`, balance: parseUnits("10000", 18).toString()}],
      saveDeployments: false,
      allowUnlimitedContractSize: true,
    },
    polygon: {
      url: process.env.POLYGON_NODE_URL,
      accounts: [`0x${process.env.POLYGON_PRIVATE_KEY}`],
    },
    mumbai: {
      url: process.env.MUMBAI_NODE_URL,
      accounts: [`0x${process.env.MUMBAI_PRIVATE_KEY}`],
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
    token: "MATIC",
    // gasPrice: 100, // Set to 100 GWei
    gasPriceApi:
      "https://api.polygonscan.com/api?module=proxy&action=eth_gasPrice",
    showTimeSpent: true,
  },
  etherscan: {
    apiKey: process.env.POLYGONSCAN_KEY,
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
  },
  namedAccounts: {
    deployer: {
      31337: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // Hardhat chain id.
      137: "0x452181dAe31Cf9f42189df71eC64298993BEe6d3", // Polygon mainnet chain id.
      80001: "0x917A19E71a2811504C4f64aB33c132063B5772a5", // Mumbai testnet chain id.
    },
  },
  mocha: {
    timeout: 0,
  },
};
