const SuperfluidSDK = require("@superfluid-finance/js-sdk");
const {task} = require("hardhat/config");

task("CreateSIP", "Creates a SIP contract for a dHedge pool")
    .addParam("pool", "The dHedge pool's address")
    .addParam("key", "SF registration key")
    .addOptionalParam("bank", "Address of the dHedge bank contract", "0xF01696558f28CB1676Fca25f3A3C16b0951366b6")
    .setAction(async(taskArgs) => {
        const { deploy } = deployments;
        const { deployer } = await getNamedAccounts();
        const dHedgeHelper = await ethers.getContractAt("dHedgeHelper", "0x0D774cFd944651418ecAAE8782a7C629c6ED4Bf0");    

        const sf = new SuperfluidSDK.Framework({
            web3,
            version: "v1"
        });
    
        await sf.initialize();

        console.info(`\n--Deploying SIP contract for dHedge pool at ${taskArgs.pool}--\n`);

        const dHedgeCore = await deploy("dHedgeCore", {
            from: deployer,
            libraries: {
                dHedgeHelper: dHedgeHelper.address
            },
            args: [
                sf.host.address,
                sf.agreements.cfa.address,
                taskArgs.pool,
                taskArgs.bank,
                taskArgs.key
            ]
        });

        console.info(`\n--Deployed contract at ${dHedgeCore.address}--\n`);
    });