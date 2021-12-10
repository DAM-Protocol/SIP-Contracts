const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");
const { provider, loadFixture } = waffle;
// const { smock } = require("@defi-wonderland/smock");
const { parseUnits } = require("@ethersproject/units");
const { web3tx } = require("@decentral.ee/web3-helpers");
const {
    getBigNumber,
    getTimeStamp,
    getTimeStampNow,
    getDate,
    getSeconds,
    increaseTime,
    currentBlockTimestamp,
    setNextBlockTimestamp,
    convertTo,
    convertFrom,
    impersonateAccounts,
} = require("../../helpers/helpers");
const { defaultAbiCoder } = require("ethers/lib/utils");
const { decryptCrowdsale } = require("@ethersproject/json-wallets");

const uniswap_address = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";

const USDT = {
    address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    decimal: 6,
};
const USDC = {
    address: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    decimal: 6,
};
const WETH = {
    address: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
    decimal: 18,
};
const WMATIC = {
    address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    decimal: 18,
};
const LINK = {
    address: "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39",
    decimal: 18,
};

const USDTWhaleAddr = "0x0d0707963952f2fba59dd06f2b425ace40b492fe";
const USDCWhaleAddr = "0x6e7a5fafcec6bb1e78bae2a1f0b612012bf14827";
const WETHWhaleAddr = "0xadbf1854e5883eb8aa7baf50705338739e558e5b";
const WMATICWhaleAddr = "0xadbf1854e5883eb8aa7baf50705338739e558e5b";
const LINKWhaleAddr = "0x6914FC70fAC4caB20a8922E900C4BA57fEECf8E1";

describe("DCA Testing", () => {
    const [admin] = provider.getWallets();

    let USDTContract, USDCContract, WETHContract, WMATICContract, LINKContract;
    let USDTWhale, USDCWhale, WETHWhale, WMATICWhale, LINKWhale;
    let dca, cla;

    before(async () => {
        [USDTWhale, USDCWhale, WETHWhale, WMATICWhale, LINKWhale] = await impersonateAccounts([
            USDTWhaleAddr,
            USDCWhaleAddr,
            WETHWhaleAddr,
            WMATICWhaleAddr,
            LINKWhaleAddr,
        ]);
        USDTContract = await ethers.getContractAt("IERC20", USDT.address);
        USDCContract = await ethers.getContractAt("IERC20", USDC.address);
        WETHContract = await ethers.getContractAt("IERC20", WETH.address);
        WMATICContract = await ethers.getContractAt("IERC20", WMATIC.address);
        LINKContract = await ethers.getContractAt("IERC20", LINK.address);

        // await USDTWhale.sendTransaction({ 9999995338996000000000
        //     to: admin.address,
        //     value: ethers.utils.parseEther("1000.0"), // Sends exactly 1.0 ether
        // });
        await USDTContract.connect(USDTWhale).transfer(admin.address, "1000000000");
        await USDCContract.connect(USDCWhale).transfer(admin.address, "1000000000");
        await LINKContract.connect(LINKWhale).transfer(admin.address, "1000000000000000000000");
        await WETHContract.connect(WETHWhale).transfer(admin.address, "1000000000000000000000");
        await WMATICContract.connect(WMATICWhale).transfer(admin.address, "1000000000000000000000");

        const ChainLinkAggregator = await ethers.getContractFactory("ChainLinkAggregator");
        cla = await ChainLinkAggregator.deploy();
        await cla.deployed();

        const DCA = await ethers.getContractFactory("DCAChainLink");
        dca = await DCA.deploy(uniswap_address, cla.address, LINK.address, "10000000000000000");
        await dca.deployed();

        cla.addOracle(USDT.address, "0x0A6513e40db6EB1b165753AD52E80663aeA50545"); // usdt-usd oracle
        cla.addOracle(USDC.address, "0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7"); // usdc-usd oracle
        cla.addOracle(LINK.address, "0xd9FFdb71EbE7496cC440152d43986Aae0AB76665"); // link-usd oracle
        cla.addDirectOracle(WMATIC.address, WETH.address, "0x327e23A4855b6F663a28c5161541d69Af8973302"); // weth-usd oracle
        // console.log("TEST", USDTContract, USDTWhale);
    });
    // it("Oracle Test", async () => {
    //     let priceUSDTUSDC = await cla.getPrice(USDT.address, USDC.address);
    //     priceUSDTUSDC = parseInt(priceUSDTUSDC.toString());
    //     console.log("priceUSDTUSDC", priceUSDTUSDC / 1e18);

    //     let priceWETHWMATIC = await cla.getPrice(WETH.address, WMATIC.address);
    //     priceWETHWMATIC = parseInt(priceWETHWMATIC.toString());
    //     console.log("priceWETHWMATIC", priceWETHWMATIC / 1e18);

    //     let priceWMATICWETH = await cla.getPrice(WMATIC.address, WETH.address);
    //     priceWMATICWETH = parseInt(priceWMATICWETH.toString());
    //     console.log("priceWMATICWETH", priceWMATICWETH / 1e18);

    //     let priceLINKUSDC = await cla.getPrice(LINK.address, USDC.address);
    //     priceLINKUSDC = parseInt(priceLINKUSDC.toString());
    //     console.log("priceLINKUSDC", priceLINKUSDC / 1e18);

    //     expect(priceUSDTUSDC).to.be.greaterThan(0);
    // });
    it("Check Balance", async () => {
        console.log("Balance : ", (await provider.getBalance(USDTWhaleAddr)).toString());

        console.log("Balance : ", (await provider.getBalance(admin.address)).toString());
    });

    it("DCA Test", async () => {
        await USDTContract.approve(dca.address, "1000000000000000000000000000");
        await LINKContract.approve(dca.address, "1000000000000000000000000000");
        await WETHContract.approve(dca.address, "1000000000000000000000000000");
        await WMATICContract.approve(dca.address, "1000000000000000000000000000");
        // USDCContract.approve(dca.address, "1000000000000000000000000000");
        let newTaskTx = await dca.newTask(WMATIC.address, USDC.address, "1000000000000000000", 20, 7, { value: "1000000000000000000" });
        await newTaskTx.wait();
        // console.log(await dca.checkTask(0));
        // console.log(await USDCContract.balanceOf(admin.address));
        // expect(await dca.checkTask(0)).to.equal(true);
        let gas = await dca.estimateGas.checkUpkeep("0x0000000000000000000000000000000000000000000000000000000000000000");
        console.log("Gas Used : ", gas);
        let upkeepData = await dca.checkUpkeep("0x0000000000000000000000000000000000000000000000000000000000000000");
        console.log(upkeepData);
        if (upkeepData.upkeepNeeded) console.log(await dca.performUpkeep(upkeepData.performData));
        console.log("Admin Balance : ", (await provider.getBalance(admin.address)).toString());
        console.log("Test Balance : ", (await provider.getBalance("0x3c6812B64E44bfd348A08EE3Caf8d1B85a36478c")).toString());
        await dca.collectFees("0x3c6812B64E44bfd348A08EE3Caf8d1B85a36478c");
        console.log("Test Balance after collection : ", (await provider.getBalance("0x3c6812B64E44bfd348A08EE3Caf8d1B85a36478c")).toString());

        // console.log(await dca.checkTask(0));
        console.log(await USDCContract.balanceOf(admin.address));
        // gas = await dca.estimateGas.checkUpkeep("0x0000000000000000000000000000000000000000000000000000000000000000");
        // console.log("Gas Used : ", gas);
    });
});
