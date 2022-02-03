// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {IInstantDistributionAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IInstantDistributionAgreementV1.sol";

/**
 * @title dHedge storage library
 * @author rashtrakoff
 * @dev Contains a struct which defines a dHedge pool for a core contract
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable contract-name-camelcase
// solhint-disable var-name-mixedcase
library dHedgeStorage {
    /**
     * @param superToken Contains supported supertoken of an underlying token.
     * @param distIndex IDA distribution index with respect to an underlying token.
     * @param lastDepositAt Latest timestamp of when an underlying token was deposited to a dHEDGE pool.
     */
    struct TokenData {
        ISuperToken superToken;
        uint32 distIndex;
        uint256 lastDepositAt;
    }

    /**
     * @notice Struct containing data related to a dHEDGE pool and it's corresponding core contract.
     * @param isActive Status of contract representing a dHEDGE pool.
     * @param DHPTx DHP super token for a dHEDGE pool.
     * @param factory Factory contract which deployed the core contract
     * @param poolLogic Address of a dHEDGE pool.
     * @param latestDistIndex Latest index created for distributing DHPTx according to a deposit token stream rate
     * of a user
     * between deposits in order to guard against perpetual cooldown issues
     * @param tokenData Contains data regarding a market/deposit token
     */
    struct dHedgePool {
        bool isActive;
        ISuperToken DHPTx; 
        address factory;
        address poolLogic;
        uint32 latestDistIndex;
        mapping(address => TokenData) tokenData;
    }
}
