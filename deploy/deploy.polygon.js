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
        skipIfAlreadyDeployed: false
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
    
    const dHedgeUpkeep = await deploy("dHedgeUpkeepGelato", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true
    });    

    try {
        try {
            await hre.run("verify:verify", {
                address: SFHelper.address
            });
        } catch (error) {
            console.log(`${error.message} for SFHelper at address ${SFHelper.address}`);
        }
        
        try {
            await hre.run("verify:verify", {
                address: dHedgeStorage.address,
                contract: "contracts/dHedge/Libraries/dHedgeStorage.sol:dHedgeStorage"
            });
        } catch (error) {
            console.log(`${error.message} for dHedgeStorage at address ${dHedgeStorage.address}`);
        }

        try {
            await hre.run("verify:verify", {
                address: dHedgeHelper.address,
                libraries: {
                    SFHelper: SFHelper.address
                },
                contract: "contracts/dHedge/Libraries/dHedgeHelper.sol:dHedgeHelper"
            });
        } catch (error) {
            console.log(`${error.message} for dHedgeHelper at address ${dHedgeHelper.address}`);
        }

        try {
            await hre.run("verify:verify", {
                address: dHedgeBank.address
            });
        } catch (error) {
            console.log(`${error.message} for dHedgeBank at address ${dHedgeBank.address}`);
        }
        
        try {
            await hre.run("verify:verify", {
                address: dHedgeUpkeep.address
            });
        } catch (error) {
            console.log(`${error.message} for dHedgeUpkeep at address ${dHedgeUpkeep.address}`);
        }
    } catch (error) {
        console.log(`Infrastructure contract verification failed: ${error.message}`);
    }

    console.info("\n--Infrastructure setup complete !--\n");
}