/* eslint-disable no-undef */
/* eslint-disable node/no-unpublished-require */
const { task, types } = require("hardhat/config");

task("CreateMockPool", "Creates a mock dHEDGE pool")
  .addParam("name", "Name of the new pool")
  .addParam("symbol", "Symbol of the token of the new pool")
  .addOptionalParam("decimals", "Decimals for the pool token", 18, types.int)
  .setAction(async (taskArgs, deployments) => {
    const { deployer } = await getNamedAccounts();

    console.log("--Starting deployment of new mock dHEDGE pool--");

    const mockPoolFactory = await ethers.getContractFactory(
      "MockdHEDGEPool",
      deployer
    );

    const newdHEDGEPool = await mockPoolFactory.deploy(
      taskArgs.name,
      taskArgs.symbol,
      taskArgs.decimals
    );

    await newdHEDGEPool.deployed();

    try {
      await hre.run("verify:verify", {
        address: newdHEDGEPool.address,
        constructorArguments: [
          taskArgs.name,
          taskArgs.symbol,
          taskArgs.decimals,
        ],
        contract: "contracts/mocks/MockdHEDGEPool.sol:MockdHEDGEPool",
      });
    } catch (error) {
      console.log(
        `${error.message} for mock dHEDGE pool at address ${newdHEDGEPool.address}`
      );
    }

    console.log(`--New mock pool deployed at ${newdHEDGEPool.address}--`);
  });
