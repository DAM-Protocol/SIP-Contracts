// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
// import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {FlowData} from "../../Common/SFHelper.sol";

/**
 * @title dHedge storage library
 * @author rashtrakoff
 * @dev Contains a struct which defines a dHedge pool for a core contract
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable contract-name-camelcase
library dHedgeStorage {
    /**
     * @param superToken Contains supported supertoken of an underlying token.
     * @param currMarketIndex Represents the market index for a token. Useful for tracking users' entry and share.
     * @param lendingData Array containing total amount of a token invested, 
     * total LP token received and the lending timestamp. First parameter is market index followed by the address
     * of underlying token.
     */
    struct TokenData {
        address superToken;
        uint256 currMarketIndex;
        mapping(uint256 => uint256[3]) lendingData;
    }

    /**
     * @param userFlow Flow details corresponding to a user and a supertoken
     * @param lockedShareAmount Share amount locked according to dHedge cooldown requirements
     */
    struct UserData {
        FlowData userFlow;
        uint256 lockedShareAmount;
    }

    /**
     * @notice Data related to lending of a token.
     * @param host Superfluid host contract.
     * @param cfa Superfluid constant flow agreement class address.
     * @param isActive Status of contract representing a dHedge pool.
     * @param lastDepositTime Last time a deposit action took place in the pool. Useful to limit the time difference
     * between deposits in order to guard against perpetual cooldown issues
     * @param tokenData Contains data regarding a market (a token)
     * @param userFlows Details of users' flows and investments (address1 = user address, address2 = underlying token address)
     * @param redeemData Contains amount of LP tokens withdrawn by a user
     * @param tokenSet Contains addresses of all the tokens currently supported by our contracts and the market
     */
    struct dHedgePool {
        ISuperfluid host;
        IConstantFlowAgreementV1 cfa;
        bool isActive;
        uint256 lastDepositTime;
        address poolLogic;
        address bank;
        address[] tokenSet;
        mapping(address => TokenData) tokenData;
        mapping(address => mapping(address => UserData)) userFlows;
        mapping(address => uint256) redeemData;
    }
}
