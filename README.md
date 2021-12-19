# :sparkles: Introduction

There aren't many DeFi projects which allow for, what we call in TradFi, Systematic Investment Plans. We hope to change that with the introduction of our project which allows a user to subscribe to various investment plans which are automated to provide maximum efficiency and minimum effort. The aim was to minimize user's active involvement in managing their portfolio and hence, we automated the necessary parts of investing into different strategies (dHedge and Sushiswap DCA). Only thing the user needs to do is set some parameters and forget the rest (I mean leave everything else to us !). First aspect of our project is called Super-dHedge and it's the integration of dHedge with Superfluid constant flow agreements allowing you to set a stream of tokens to DCA into a dHedge pool. Second aspect is called Auto Dollar Cost Averaging which allows traditional DCA involving pools on Sushiswap. We believe that this strategy will allow for custom parameters/control over their DCA strategy.

&nbsp;

## dHEDGE :handshake: Superfluid (Super dHEDGE)


​dHEDGE is a one-stop location for managing investment activities on-chain where you can put your capital to work in different strategies based on a transparent track record.

With our Superfluid enabled integration, users of dHEDGE can subscribe to any active pool/fund using Superfluid supported/equivalent supertokens of the underlying tokens which are accepted by the dHEDGE pool. A user just has to start a stream. Tokens are deposited into the dHEDGE pool regularly (in approx 24 hour periods) using keepers (Gelato network keepers for the time being). DHPT (dHEDGE Pool Tokens) are minted after each deposit and these are then available for withdrawal after approx 24 hours for the user.

Furthermore, we provide details to track how much has been streamed/deposited to a dHEDGE pool, how much of your streamed amount is uninvested and how much DHPT (dHEDGE Pool Tokens) you can withdraw from our contracts.

We plan to upgrade/modify contracts to support Superfluid IDA (Instant Distribution Agreement) functionality later. This would enable us to distribute the DHPT minted instantly to the users. We also plan to deploy these contract to Optimism once they gain popularity and are proven to be safe enough.

&nbsp;

<p align="center">
    <img src="misc/images/Auto%20DCA.png" alt="Tech used in Super D HEDGE" width="300" height="200"/>
</p>

&nbsp;

## :robot: Auto Dollar Cost Averaging

This product allows a user to create custom DCA task. This custom task is then monitored by Chainlink Keepers' and executed as per the parameters set by the user during task creation. Gas fees are taken upfront from the user for the entire duration of the task (in MATIC).

&nbsp;

<p align="center">
    <img src="misc/images/Auto%20DCA.png" alt="Tech used in Auto Dollar Cost Averaging" width="300" height="200"/>
</p>

&nbsp;

## :building_construction: Deployments

### Super dHEDGE

---

#### :office: Infrastructure (Core and Helper Contracts)

| Contract Name | Address |
| ------------- | ------- |
| [SFHelper](https://polygonscan.com/address/0x18CA85221385D8a4A0Dcb8c7FE5aD1f22843349b#code) | 0x18CA85221385D8a4A0Dcb8c7FE5aD1f22843349b |
| [dHedgeHelper](https://polygonscan.com/address/0x66E230030d7C45a6fe4d8d3661900fd4d95Aef07#code) | 0x66E230030d7C45a6fe4d8d3661900fd4d95Aef07 |
| [dHedgeStorage](https://polygonscan.com/address/0x0528029C92dB92c466c3fd7bDff7cd0f25126829#code) | 0x0528029C92dB92c466c3fd7bDff7cd0f25126829 |
| [dHedgeBank](https://polygonscan.com/address/0xF01696558f28CB1676Fca25f3A3C16b0951366b6#code) | 0xF01696558f28CB1676Fca25f3A3C16b0951366b6 |
| [dHedgeUpkeepGelato](https://polygonscan.com/address/0xa78C29cFbabe6829Cbf645DB532a9e597254F5C1#code) | 0xa78C29cFbabe6829Cbf645DB532a9e597254F5C1 |

&nbsp;

#### :money_with_wings: Active Super dHEDGE Pools

| Pool Name | dHEDGE Pool Address | Super dHEDGE Address |
| --------- | ------------------- | -------------------- |
| [dHEDGE Stablecoin Yield](https://app.dhedge.org/pool/0xbae28251b2a4e621aa7e20538c06dee010bc06de) | 0xbae28251b2a4e621aa7e20538c06dee010bc06de | 0xC05B38Dd7D1bc0E65b2EE5dF19AC4296B382Cb10 |

&nbsp;

### Auto DCA

<p align="center">
    :construction: **Section under construction**
</p>

&nbsp;

## :man_technologist: Technology

- **Super dHEDGE**

1. [dHEDGE](https://www.dhedge.org/) - Discover top performing DeFi strategies.
2. [Superfluid](https://www.superfluid.finance/home) - Allows for subscribing to a particular dHEDGE pool/fund.
3. [Gelato](https://www.gelato.network/) - Used to automate deposits to dHEDGE pools/funds.

- **Auto DCA**

1. [Sushiswap](https://sushi.com/) - Swap, earn, stack yields, lend, borrow, leverage all on one decentralized, community driven platform.
2. [Chainlink](https://chain.link/) - Keepers network and oracles used for automating a user's DCA task and ensuring best prices respectively.

