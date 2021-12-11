const { parseUnits } = require("ethers/lib/utils");

require("dotenv").config();
require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-web3");
require("hardhat-gas-reporter");
require("solidity-coverage");
require("hardhat-contract-sizer");
require("hardhat-tracer");

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
    solidity: "0.8.4",
    networks: {
        hardhat: {
            initialBaseFeePerGas: 0, // workaround from https://github.com/sc-forks/solidity-coverage/issues/652#issuecomment-896330136 . Remove when that issue is closed.
            forking: {
                url: process.env.POLYGON_NODE_URL,
                // blockNumber: 21170576,
                enabled: true,
            },
            accounts: [{ privateKey: `0x${process.env.MAINNET_PRIVATE_KEY}`, balance: parseUnits("10000", 18).toString() }],
        },
        local: {
            url: "http://localhost:7545",
            gas: "auto",
            gasPrice: "auto",
            accounts: [process.env.GANACHE_PRIVATE_KEY],
        },
        kovan: {
            url: process.env.KOVAN_NODE_URL || "",
            blockNumber: 28162760,
        },
        polygon: {
            url: process.env.POLYGON_NODE_URL,
            gas: "auto",
            gasPrice: "auto",
            accounts: [process.env.PRIVATE_KEY],
        },
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS !== undefined,
        currency: "USD",
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
    contractSizer: {
        alphaSort: true,
        disambiguatePaths: false,
        runOnCompile: true,
    },
    mocha: {
        timeout: 0,
    },
};
