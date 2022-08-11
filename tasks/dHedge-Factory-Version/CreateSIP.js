/* eslint-disable node/no-unpublished-require */
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
    );

    console.info(`Deploying core contract for dHedge pool ${taskArgs.pool}`);

    const tx = await dHedgeCoreFactory.createdHedgeCore(
      taskArgs.pool,
      taskArgs.supertoken
    );

    await tx.wait();

    console.info(
      `Deployed core contract. Check ${tx.hash} on polygonscan for more info`
    );

    console.warn("You still have to initialize markets for individual tokens!");
  });
