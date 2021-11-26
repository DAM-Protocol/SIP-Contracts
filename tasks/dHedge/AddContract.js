const {task} = require("hardhat/config");

task("AddContract", "Adds contract to dHedgeUpkeep for upkeep services")
    .addParam("contract", "Address of the contract")
    .setAction(async(taskArgs) => {
        // const { deployer } = await getNamedAccounts();
        // const dHedgeUpkeep = await ethers.getContractAt("dHedgeUpkeepChainlink", "0xb066DcF5A6917681F702cAcEC655742C83D60809");
        const dHedgeUpkeep = await ethers.getContractAt("dHedgeUpkeepGelato", "0x45635A02119409a25380bC05507E7a7c097F6a99");

        await dHedgeUpkeep.addContract(taskArgs.contract);

        console.info("\n--Contract added to dHedgeUpkeep !--\n");
    });