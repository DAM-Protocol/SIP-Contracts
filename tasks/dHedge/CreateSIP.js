const SuperfluidSDK = require("@superfluid-finance/js-sdk");
const { task, types } = require("hardhat/config");

task("CreateSIP", "Creates a SIP contract for a dHedge pool")
    .addParam("pool", "The dHedge pool's address")
    .addParam("key", "SF registration key")
    .addOptionalParam("bank", "Address of the dHedge bank contract", "0xF01696558f28CB1676Fca25f3A3C16b0951366b6")
    .addOptionalParam("check", "skipIfAlreadyDeployed is enabled if true", true, types.boolean)
    .setAction(async (taskArgs) => {
        const { deploy } = deployments;
        const { deployer } = await getNamedAccounts();
        const dHedgeHelper = await deployments.get("dHedgeHelper");

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
            ],
            skipIfAlreadyDeployed: taskArgs.check
        });

        console.info(`\n--Deployed contract at ${dHedgeCore.address}--\n`);

        try {
            await hre.run("verify:verify", {
                address: dHedgeCore.address,
                constructorArguments: [
                    sf.host.address,
                    sf.agreements.cfa.address,
                    taskArgs.pool,
                    taskArgs.bank,
                    taskArgs.key
                ]
            });
        } catch (error) {
            console.log(`${error.message} for dHedgeCore at address ${dHedgeCore.address}`);
        }

        await hre.run("PauseCore", {
            core: dHedgeCore.address,
            pause: false
        });
    });