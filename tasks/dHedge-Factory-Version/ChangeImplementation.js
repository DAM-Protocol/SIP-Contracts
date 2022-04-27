task(
  "ChangeImplementation",
  "Changes implementation contract of the dHEDGE core contract"
).setAction(async (taskArgs, deployments) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const SFHelper = await deployments.get("SFHelper");
  const dHedgeHelper = await deployments.get("dHedgeHelper");
  const dHedgeStorage = await deployments.get("dHedgeStorage");
  const dHedgeCoreFactory = await deployments.get("dHedgeCoreFactory");

  console.log("\n--Beginning implementation deployment--\n");

  const dHedgeCoreImplementation = await deploy("dHedgeCore", {
    from: deployer,
    libraries: {
      SFHelper: SFHelper.address,
      dHedgeStorage: dHedgeStorage.address,
      dHedgeHelper: dHedgeHelper.address,
    },
    log: true,
    skipIfAlreadyDeployed: true,
  });

  console.log(
    `\n--Implementation deployed at: ${dHedgeCoreImplementation.address}--\n`
  );

  const dHedgeCoreFactoryContract = await ethers.getContractAt(
    "dHedgeCoreFactory",
    dHedgeCoreFactory.address
  );

  await dHedgeCoreFactoryContract.setImplementation(
    dHedgeCoreImplementation.address,
    "Whitelist workaround implemented"
  );

  try {
    await hre.run("verify:verify", {
      address: dHedgeCoreImplementation.address,
      contract: "contracts/dHedge-Factory-Version/dHedgeCore.sol:dHedgeCore",
    });
  } catch (error) {
    console.log(
      `${error.message} for dHedgeCore at address ${dHedgeCoreImplementation.address}`
    );
  }
});
