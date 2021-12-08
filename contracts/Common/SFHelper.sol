// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "hardhat/console.sol";

/**
 * @title Modified IERC20 interface
 * @dev This interface is used to access decimals of a ERC20 token
 */
interface IERC20Mod {
    function decimals() external view returns (uint8);
}

struct FlowData {
    uint256 updateIndex; // Market index at the time of flow update. If 0, user never streamed.
    uint256 uninvestedSum; // Total amount that hasn't yet been invested in any market
    uint256 shareAmount; // Total share of LP tokens accrued
    uint256 prevUpdateTimestamp; // Last time a withdrawal was made or flow was updated
}

/**
 * @title Superfluid helper library
 * @author rashtrakoff
 * @dev Contains functions which help with Superfluid streams related calculations
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
library SFHelper {
    /**
     * @dev Calculates LP token share of a user for a particular invested token
     * @param _userFlow Struct containing streamed token details of a user
     * @param _token Address of the underlying token
     * @param _flowRate Flow rate of a user's stream of underlying token
     * @param _totalInvestedBefore Total amount of tokens invested by a contract till user's last update of the stream
     * @param _totalInvestedCurr Total amount of tokens invested by a contract till the current market index
     * @param _totalReceivedBefore Total amount of LP tokens received till user's last update of the stream
     * @param _totalReceivedCurr Total amount of LP tokens received till the current market index
     * @param _marketLastLentAt Timestamp of market's latest deposit action
     * @return Amount representing the share of a user of LP tokens
     * This function automatically adjusts amounts based on token decimals and is found to be a bit inaccurate
     * when it comes to tokens with decimals less than 18 (ex: USDC and USDT). This behaviour is unavoidable.
     */
    function calcShare(
        FlowData storage _userFlow,
        address _token,
        uint256 _flowRate,
        uint256 _totalInvestedBefore,
        uint256 _totalInvestedCurr,
        uint256 _totalReceivedBefore,
        uint256 _totalReceivedCurr,
        uint256 _marketLastLentAt
    ) external view returns (uint256) {
        // Amount invested by user till date
        uint256 _userInvested = decimalAdjust(
            calcUserInvestedAfterUpdate(
                _userFlow,
                _flowRate,
                _marketLastLentAt
            ),
            getDecimals(_token),
            false
        );

        console.log(
            "Total invested curr - %s, Total invested before - %s",
            _totalInvestedCurr,
            _totalInvestedBefore
        );

        // Amount of tokens invested into the market after the user updated his/her flow
        uint256 _totalIntervalInvestment = _totalInvestedCurr -
            _totalInvestedBefore;

        // Amount of LP tokens received by the market after the user updated his/her flow
        uint256 _totalIntervalReceived = _totalReceivedCurr -
            _totalReceivedBefore;

        // Amount of LP tokens accrued by the user during the entirety of his/her involvement in the market
        uint256 _share;

        if (_totalIntervalInvestment == uint256(0))
            _share = _userFlow.shareAmount;
        else
            _share =
                _userFlow.shareAmount +
                (_userInvested * _totalIntervalReceived) /
                _totalIntervalInvestment;

        // console.log(
        //     "User Invested in that interval - %s, Total received in that interval - %s, Total invested in that interval - %s",
        //     _userInvested,
        //     _totalIntervalReceived,
        //     _totalIntervalInvestment
        // );

        return _share;
    }

    /**
     * @dev Calculates uninvested amount of a user
     * @param _userFlow Struct containing streamed token details of a user
     * @param _flowRate Flow rate of a user's stream of underlying token
     * @param _marketLastLentAt Timestamp of market's latest deposit action
     * @return User's uninvested amount
     */
    function calcUserUninvested(
        FlowData storage _userFlow,
        uint256 _flowRate,
        uint256 _marketLastLentAt
    ) external view returns (uint256) {
        uint256 _userUninvestedSum = _userFlow.uninvestedSum;
        uint256 _userPrevUpdateTimestamp = _userFlow.prevUpdateTimestamp;

        // solhint-disable not-rely-on-time
        (_userPrevUpdateTimestamp > _marketLastLentAt)
            ? _userUninvestedSum +=
                _flowRate *
                (block.timestamp - _userPrevUpdateTimestamp)
            : _userUninvestedSum =
            _flowRate *
            (block.timestamp - _marketLastLentAt);
        // solhint-enable not-rely-on-time

        // console.log("Uninvested amount is: %s", _userUninvestedSum);

        return _userUninvestedSum;
    }

    /**
     * @dev Calculated amount invested after updating his/her stream
     * @param _userFlow Struct containing streamed token details of a user
     * @param _flowRate Flow rate of a user's stream of underlying token
     * @param _marketLastLentAt Timestamp of market's latest deposit action
     * @return User invested amount after updating a stream
     */
    function calcUserInvestedAfterUpdate(
        FlowData storage _userFlow,
        uint256 _flowRate,
        uint256 _marketLastLentAt
    ) public view returns (uint256) {
        return
            (_userFlow.prevUpdateTimestamp > _marketLastLentAt)
                ? 0
                : _userFlow.uninvestedSum +
                    (_flowRate *
                        (_marketLastLentAt - _userFlow.prevUpdateTimestamp));
    }

    /**
     *@notice Function to get the flow rate of a user
     * @param _cfa Superfluid CFA class address
     * @param _sender Address of the user
     * @param _superToken Address of the supertoken
     * @return Flow rate of a user
     */
    function getFlow(
        IConstantFlowAgreementV1 _cfa,
        address _sender,
        address _superToken
    ) public view returns (uint256) {
        (, int96 _inFlowRate, , ) = _cfa.getFlow(
            ISuperToken(_superToken),
            _sender,
            address(this)
        ); // CHECK: unclear what happens if flow doesn't exist.

        assert(_inFlowRate >= int96(0));

        return uint256(uint96(_inFlowRate));
    }

    /**
     * @dev Helper function to get decimals of a token
     * @param _token Address of the token
     * @return number representing decimal precision of a token
     */
    function getDecimals(address _token) public view returns (uint256) {
        return uint256(IERC20Mod(_token).decimals());
    }

    /**
     * @dev Adjusts amount according to decimals of a token
     * @param _amount Amount to be decimal adjusted
     * @param _decimals Decimals of the token to be used for adjustment
     * @param _upScale Indicates whether the amount needs to be scaled up or scaled down
     */
    function decimalAdjust(
        uint256 _amount,
        uint256 _decimals,
        bool _upScale
    ) public pure returns (uint256) {
        if (_upScale) return _amount * (10**(18 - _decimals));
        else return (_amount * (10**_decimals)) / 1e18;
    }

    /**
     * @dev Updates details in a user's flow data struct
     * @param _userFlow Struct containing streamed token details of a user
     * @param _prevUninvestedSum Uninvested amount of a user at the time of updation of the stream
     * @param _shareAmount User's LP tokens share corresponding to a invested amount of token at the time of updation of the stream
     */
    function _updateFlowDetails(
        FlowData storage _userFlow,
        uint256 _prevUninvestedSum,
        uint256 _shareAmount
    ) internal {
        _userFlow.uninvestedSum = _prevUninvestedSum;
        _userFlow.shareAmount = _shareAmount;
        _userFlow.prevUpdateTimestamp = block.timestamp; // solhint-disable-line not-rely-on-time
    }

    /**
     * @notice Downgrades a supertoken to it's underlying ERC20 token
     * @param _superToken Address of the supertoken
     * @param _amount Amount of the supertoken to be downgraded
     */
    function _downgradeToken(address _superToken, uint256 _amount) internal {
        ISuperToken(_superToken).downgrade(_amount);
    }
}
