const { task, types } = require("hardhat/config");

task("DeactivateCore", "Task to deactivate or reactivate a core contract")
    .addParam("core", "Address of the core contract")
    .addParam("deactivate", "Boolean representing deactivating the contract or reactivating it", true, types.boolean)
    .setAction(async (taskArgs) => {
        const dHedgeCore = await ethers.getContractAt("dHedgeCore", taskArgs.core);

        try {
            if(taskArgs.deactivate) {
                await dHedgeCore.deactivateCore();
                await hre.run("PauseCore", {
                    core: dHedgeCore.address,
                    pause: true
                });
            } else {
                await dHedgeCore.reactivateCore();
                await hre.run("PauseCore", {
                    core: dHedgeCore.address,
                    pause: false
                });
            }
            
            console.info(`Core contract ${(taskArgs.deactivate) ? "deactivate": "reactivate"} complete !`);
        } catch (error) {
            console.info(`${error.message} while ${(taskArgs.pause) ? "deactivating": "reactivating"} the core contract at ${taskArgs.core}`);
        }
    });