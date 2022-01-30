const { task, types } = require("hardhat/config");

task("PauseCore", "Task to pause or unpause a core contract from receiving upkeep services")
    .addParam("core", "Address of the core contract")
    .addParam("pause", "Boolean representing pausing the contract or unpausing it", false, types.boolean)
    .setAction(async (taskArgs) => {
        // const dHedgeUpkeepGelato = await deployments.get("dHedgeUpkeepGelato");
        const dHedgeUpkeepGelato = await ethers.getContractAt("dHedgeUpkeepGelato", "0xa78C29cFbabe6829Cbf645DB532a9e597254F5C1");

        try {
            (taskArgs.pause) 
            ? await dHedgeUpkeepGelato.pauseContract(taskArgs.core) 
            : await dHedgeUpkeepGelato.unPauseContract(taskArgs.core);
            
            console.info(`Core contract ${(taskArgs.pause) ? "pause": "unpause"} complete !`);
        } catch (error) {
            console.info(`${error.message} while ${(taskArgs.pause) ? "pausing": "unpausing"} the core contract at ${taskArgs.core}`);
        }
    });