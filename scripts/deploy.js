async function main() {
    // We get the contract to deploy
    const ChainLinkAggregator = await ethers.getContractFactory("ChainLinkAggregator");
    const DCAChainLink = await ethers.getContractFactory("DCAChainLink");
    const chain_link_aggregator = await ChainLinkAggregator.deploy();
    const dca_chain_link = await DCAChainLink.deploy(
        "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
        chain_link_aggregator.address,
        "100000000000000000"
    );

    console.log("Deployed to:", chain_link_aggregator.address, "\n", dca_chain_link.address);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
