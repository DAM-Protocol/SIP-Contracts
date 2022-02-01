const SuperfluidSDK = require("@superfluid-finance/sdk-core");
const { task } = require("hardhat/config");

task("CreateSIP", "Creates a SIP contract for a dHEDGE pool")
    .addParam("pool", "The dHEDGE pool's address")
    .addParam("poolSuperToken", "The DHPTx address for the pool")
    .addOptionalParam("factory", "Address of dHedgeCoreFactory contract")
    .setAction(async (taskArgs) => {
        const { deploy } = deployments;
        const { deployer } = await getNamedAccounts();
        const dHedgeCoreFactory = await ethers.getContractAt("dHedgeCoreFactory", ) // Complete this after deployment of infrastructure

        const sf = await SuperfluidSDK.Framework.create({
            networkName: "matic",
            dataMode: "WEB3_ONLY",
            resolverAddress: "0xE0cc76334405EE8b39213E620587d815967af39C", // Polygon mainnet resolver
            protocolReleaseVersion: "v1",
            provider: ethers.provider
        });

        console.info(`\n--Deploying core contract for dHedge pool ${taskArgs.pool}--\n`);

        await dHedgeCoreFactory.createdHedgeCore(taskArgs.pool, taskArgs.poolToken);
        
        const newCore = await dHedgeCoreFactory.cores(taskArgs.pool);

        console.info(`\n--Deployed core contract at ${newCore}--\n`);

        try {
            await hre.run("verify:verify", {
                address: newCore,
                contract: "contracts/dHedge-Factory-Version/dHedgeCore.sol:dHedgeCore"
            });
        } catch (error) {
            console.log(`${error.message} for dHedgeCore at address ${newCore}`);
        }

        // await hre.run("PauseCore", {
        //     core: dHedgeCore.address,
        //     pause: false
        // });
    });