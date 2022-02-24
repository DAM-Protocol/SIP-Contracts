const prompt = require("prompt-sync")({ sigint: true });

module.exports = async function ({ deployments, getNamedAccounts }) {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const DAOAddr = prompt("Enter DAO address: ");
  const feeRate = prompt("Enter default fee rate scaled to 1e6: ");
  const reDeploy = prompt("Do you want to re-deploy (enter true/false)? ");

  console.info("\n--Beginning infrastructure deployment--\n");

  const SFHelper = await deploy("SFHelper", {
    from: deployer,
    log: true,
    skipIfAlreadyDeployed: reDeploy,
  });

  const dHedgeStorage = await deploy("dHedgeStorage", {
    from: deployer,
    log: true,
    skipIfAlreadyDeployed: reDeploy,
  });

  const dHedgeHelper = await deploy("dHedgeHelper", {
    from: deployer,
    libraries: {
      SFHelper: SFHelper.address,
    },
    log: true,
    skipIfAlreadyDeployed: true,
  });

  const dHedgeCoreFactory = await deploy("dHedgeCoreFactory", {
    from: deployer,
    libraries: {
      SFHelper: SFHelper.address,
      dHedgeHelper: dHedgeHelper.address,
    },
    args: [DAOAddr, feeRate],
    log: true,
    skipIfAlreadyDeployed: true,
  });

  try {
    try {
      await hre.run("verify:verify", {
        address: SFHelper.address,
      });
    } catch (error) {
      console.log(
        `${error.message} for SFHelper at address ${SFHelper.address}`
      );
    }

    try {
      await hre.run("verify:verify", {
        address: dHedgeStorage.address,
        contract:
          "contracts/dHedge-Factory-Version/Libraries/dHedgeStorage.sol:dHedgeStorage",
      });
    } catch (error) {
      console.log(
        `${error.message} for dHedgeStorage at address ${dHedgeStorage.address}`
      );
    }

    try {
      await hre.run("verify:verify", {
        address: dHedgeHelper.address,
        libraries: {
          SFHelper: SFHelper.address,
        },
        contract:
          "contracts/dHedge-Factory-Version/Libraries/dHedgeHelper.sol:dHedgeHelper",
      });
    } catch (error) {
      console.log(
        `${error.message} for dHedgeHelper at address ${dHedgeHelper.address}`
      );
    }

    try {
      await hre.run("verify:verify", {
        address: dHedgeCoreFactory.address,
        libraries: {
          SFHelper: SFHelper.address,
          dHedgeHelper: dHedgeHelper.address,
        },
        constructorArguments: [DAOAddr, feeRate],
        contract:
          "contracts/dHedge-Factory-Version/dHedgeCoreFactory.sol:dHedgeCoreFactory",
      });
    } catch (error) {
      console.log(
        `${error.message} for dHedgeCoreFactory at address ${dHedgeCoreFactory.address}`
      );
    }
  } catch (error) {
    console.log(
      `Infrastructure contract verification failed: ${error.message}`
    );
  }

  console.info("\n--Infrastructure setup complete !--\n");
};
