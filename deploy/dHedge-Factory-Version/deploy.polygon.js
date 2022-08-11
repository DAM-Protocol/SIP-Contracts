/* eslint-disable node/no-unpublished-require */
const { ethers } = require("hardhat");

const prompt = require("prompt-sync")({ sigint: true });

module.exports = async function ({ deployments, getNamedAccounts }) {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  let skipDeploy = prompt(
    "Do you want to skip re-deployment (enter true/false)? "
  );

  let DAOAddr, feeRate;

  if (skipDeploy === "false") {
    skipDeploy = false;
    DAOAddr = prompt("Enter DAO address: ");
    feeRate = prompt("Enter default fee rate scaled to 1e6: ");
  } else {
    skipDeploy = true;

    const dHedgeCoreFactory = await deployments.get("dHedgeCoreFactory");
    const dHedgeCoreFactoryContract = await ethers.getContractAt(
      "dHedgeCoreFactory",
      dHedgeCoreFactory.address
    );

    DAOAddr = await dHedgeCoreFactoryContract.dao();
    feeRate = await dHedgeCoreFactoryContract.defaultFeeRate();
  }

  console.info("\n--Beginning infrastructure deployment--\n");

  const SFHelper = await deploy("SFHelper", {
    from: deployer,
    log: true,
    skipIfAlreadyDeployed: skipDeploy,
  });

  const dHedgeMath = await deploy("dHedgeMath", {
    from: deployer,
    libraries: {
      SFHelper: SFHelper.address,
    },
    log: true,
    skipIfAlreadyDeployed: skipDeploy,
  });

  const dHedgeHelper = await deploy("dHedgeHelper", {
    from: deployer,
    libraries: {
      SFHelper: SFHelper.address,
      dHedgeMath: dHedgeMath.address,
    },
    log: true,
    skipIfAlreadyDeployed: skipDeploy,
  });

  const dHedgeCoreFactory = await deploy("dHedgeCoreFactory", {
    from: deployer,
    libraries: {
      SFHelper: SFHelper.address,
      dHedgeMath: dHedgeMath.address,
      dHedgeHelper: dHedgeHelper.address,
    },
    args: [DAOAddr, feeRate],
    log: true,
    skipIfAlreadyDeployed: skipDeploy,
  });

  const dHedgeCoreFactoryContract = await ethers.getContractAt(
    "dHedgeCoreFactory",
    dHedgeCoreFactory.address
  );

  const dHedgeCoreImplementation =
    await dHedgeCoreFactoryContract.implementation();

  console.log("Core implementation address: ", dHedgeCoreImplementation);

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
        address: dHedgeMath.address,
        libraries: {
          SFHelper: SFHelper.address,
        },
        contract:
          "contracts/dHedge-Factory-Version/Libraries/dHedgeMath.sol:dHedgeMath",
      });
    } catch (error) {
      console.log(
        `${error.message} for dHedgeMath at address ${dHedgeMath.address}`
      );
    }

    try {
      await hre.run("verify:verify", {
        address: dHedgeHelper.address,
        libraries: {
          // SFHelper: SFHelper.address,
          dHedgeMath: dHedgeMath.address,
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
          dHedgeMath: dHedgeMath.address,
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

    try {
      await hre.run("verify:verify", {
        address: dHedgeCoreImplementation,
        contract: "contracts/dHedge-Factory-Version/dHedgeCore.sol:dHedgeCore",
      });
    } catch (error) {
      console.log(
        `${error.message} for dHedgeCore at address ${dHedgeCoreImplementation}`
      );
    }
  } catch (error) {
    console.log(
      `Infrastructure contract verification failed: ${error.message}`
    );
  }

  console.info("\n--Infrastructure setup complete !--\n");
};
