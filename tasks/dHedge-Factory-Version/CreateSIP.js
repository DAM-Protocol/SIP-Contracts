const SuperfluidSDK = require("@superfluid-finance/sdk-core");
const { task } = require("hardhat/config");
const dHedgeCoreFactoryABI = require("../../deployments/polygon/dHedgeCoreFactory.json");

task("CreateSIP", "Creates a SIP contract for a dHEDGE pool")
  .addParam("pool", "The dHEDGE pool's address")
  .addParam("supertoken", "The DHPTx address for the pool")
  .setAction(async (taskArgs) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const dHedgeCoreFactory = await ethers.getContractAt(
      "dHedgeCoreFactory",
      dHedgeCoreFactoryABI.address
    ); // Complete this after deployment of infrastructure

    console.info(
      `\n--Deploying core contract for dHedge pool ${taskArgs.pool}--\n`
    );

    await dHedgeCoreFactory.createdHedgeCore(
      taskArgs.pool,
      taskArgs.supertoken
    );

    const newCore = await dHedgeCoreFactory.cores(taskArgs.pool);

    console.info(`\n--Deployed core contract at ${newCore}--\n`);

    // Somehow the contracts are not able to be verified. Could it be due to CloneFactory ?
    // try {
    //   await hre.run("verify:verify", {
    //     address: newCore,
    //     contract: "contracts/dHedge-Factory-Version/dHedgeCore.sol:dHedgeCore",
    //   });
    // } catch (error) {
    //   console.log(`${error.message} for dHedgeCore at address ${newCore}`);
    // }
  });
