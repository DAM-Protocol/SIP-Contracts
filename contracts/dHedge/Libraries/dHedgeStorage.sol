// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
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
     * @notice Data related to lending of a token.
     * @param host Superfluid host contract.
     * @param cfa Superfluid constant flow agreement class address.
     * @param isActive Status of contract representing a dHedge pool.
     * @param currIndex Represents the market index. Useful for tracking users' entry and share. 
     * @param lendingData Array containing total amount of a token invested, 
     * total LP token received and the lending timestamp. First parameter is market index followed by the address
     * of underlying token.
     * @param superToken Contains supported supertoken of an underlying token.
     * @param redeemData Contains amount of LP tokens withdrawn by a user
     * @param userFlows Details of users' flows and investments (address1 = user address, address2 = underlying token address)
     * @param tokenSet Contains addresses of all the tokens currently supported by our contracts and the market
     */
    struct dHedgePool {
        ISuperfluid host;
        IConstantFlowAgreementV1 cfa;
        address poolLogic;
        address owner;
        address bank;
        bool isActive;
        uint256 currIndex;
        mapping(uint256 => mapping(address => uint256[3])) lendingData;
        mapping(address => address) superToken;
        mapping(address => mapping(address => FlowData)) userFlows;
        mapping(address => uint256) redeemData;
        EnumerableSet.AddressSet tokenSet;
    }
}
