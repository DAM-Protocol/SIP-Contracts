module.exports = async function ({ deployments, getNamedAccounts}) {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    console.info("\n--Beginning infrastructure deployment--\n");

    const SFHelper = await deploy("SFHelper", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true
    });

    const dHedgeHelper = await deploy("dHedgeHelper", {
        from: deployer,
        libraries: {
            SFHelper: SFHelper.address
        },
        log: true,
        skipIfAlreadyDeployed: true
    });

    const dHedgeStorage = await deploy("dHedgeStorage", {
        from: deployer,
        libraries: {
            SFHelper: SFHelper.address
        },
        log: true,
        skipIfAlreadyDeployed: true
    });

    const dHedgeBank = await deploy("dHedgeBank", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true
    });
    
    // const dHedgeUpkeep = await deploy("dHedgeUpkeep", {
    //     from: deployer,
    //     log: true,
    //     skipIfAlreadyDeployed: true
    // });

    console.info("\n--Infrastructure setup complete !--\n");
}