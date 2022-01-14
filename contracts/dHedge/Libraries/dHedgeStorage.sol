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
     * @param distIndex IDA distribution index with respect to an underlying token.
     * @param superToken Contains supported supertoken of an underlying token.
     * @param lastDeposit Latest timestamp of when an underlying token was deposited to a dHEDGE pool.
     */
    struct TokenData {
        ISuperToken superToken;
        uint32 distIndex;
        uint256 lastDepositAt;
    }

    /**
     * @notice Data related to lending of a token.
     * @param host Superfluid host contract.
     * @param cfa Superfluid constant flow agreement class address.
     * @param ida Superfluid instant distribution agreement class address.
     * @param DHPTx DHP super token for a dHEDGE pool.
     * @param isActive Status of contract representing a dHedge pool.
     * @param poolLogic Address of a dHEDGE pool.
     * @param feeRate Fee percentage with 6 decimals.
     * @param lastDepositTime Last time a deposit action took place in the pool. Useful to limit the time difference
     * between deposits in order to guard against perpetual cooldown issues
     * @param tokenData Contains data regarding a market (a token)
     * @dev Another variable called `lastDistributeAt` may be required.
     */
    struct dHedgePool {
        bool isActive;
        ISuperToken DHPTx; 
        address poolLogic;
        uint32 latestDistIndex;
        uint32 feeRate;
        mapping(address => TokenData) tokenData;
    }
}
