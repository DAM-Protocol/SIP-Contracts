// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import { ISuperfluid, ISuperToken, ISuperApp } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import { IConstantFlowAgreementV1 } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import { IInstantDistributionAgreementV1 } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IInstantDistributionAgreementV1.sol";
import "hardhat/console.sol";

/**
 * @title Superfluid helper library
 * @author rashtrakoff
 * @dev Contains functions which help in interacting with Superfluid contracts
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable not-rely-on-time
library SFHelper {
    event NewSupertokenAdded(
        address _superToken,
        address _underlyingToken,
        uint32 _index
    );

    ISuperfluid public constant HOST =
        ISuperfluid(0x3E14dC1b13c488a8d5D310918780c983bD5982E7);
    IConstantFlowAgreementV1 public constant CFA_V1 =
        IConstantFlowAgreementV1(0x6EeE6060f715257b970700bc2656De21dEdF074C);
    IInstantDistributionAgreementV1 public constant IDA_V1 =
        IInstantDistributionAgreementV1(
            0xB0aABBA4B2783A72C52956CDEF62d438ecA2d7a1
        );

    /**
     * @dev Function to distribute a supertoken amount according to an index
     * @param _superToken The supertoken to be distributed
     * @param _index Index containing share details
     * @param _amount Amount of `_supertoken` to be distributed
     */
    function distribute(
        ISuperToken _superToken,
        uint32 _index,
        uint256 _amount
    ) external returns (bytes memory _newCtx) {
        (uint256 _actualAmount, ) = IDA_V1.calculateDistribution(
            _superToken,
            address(this),
            _index,
            _amount
        );

        require(_amount >= _actualAmount, "SFHelper: !enough tokens");

        _newCtx = HOST.callAgreement(
            IDA_V1,
            abi.encodeWithSelector(
                IDA_V1.distribute.selector,
                _superToken,
                _index,
                _actualAmount,
                new bytes(0)
            ),
            new bytes(0)
        );

        // console.log("Actual amount distributed: %s", _actualAmount);
    }

    /**
     * @dev Function to create a distribution index
     * @param _superToken The supertoken to be distributed
     * @param _index New index value containing share details
     * @param _ctx Superfluid context object
     * This function should only be called from a superapp callback
     */
    function createIndexInCallback(
        ISuperToken _superToken,
        uint32 _index,
        bytes calldata _ctx
    ) external returns (bytes memory _newCtx) {
        (_newCtx, ) = HOST.callAgreementWithContext(
            IDA_V1,
            abi.encodeWithSelector(
                IDA_V1.createIndex.selector,
                _superToken,
                _index,
                new bytes(0) // placeholder ctx
            ),
            new bytes(0), // userData
            _ctx
        );

        emit NewSupertokenAdded(
            _superToken.getUnderlyingToken(),
            address(_superToken),
            _index
        );
    }

    /**
     * @dev Function to update shares of a user
     * @param _superStreamToken The supertoken that the user is streaming
     * @param _superDistToken The supertoken that's distributed in index with value `_index`
     * @param _index Index containing share details
     * @param _ctx Superfluid context object
     */
    function updateSharesInCallback(
        ISuperToken _superStreamToken,
        ISuperToken _superDistToken,
        uint32 _index,
        bytes calldata _ctx
    ) external returns (bytes memory _newCtx) {
        address _msgSender = HOST.decodeCtx(_ctx).msgSender;
        (, int96 _flowRate) = getFlow(_superStreamToken, _msgSender);
        uint256 _userFlowRate = uint256(uint96(_flowRate));

        (_newCtx, ) = HOST.callAgreementWithContext(
            IDA_V1,
            abi.encodeWithSelector(
                IDA_V1.updateSubscription.selector,
                _superDistToken,
                _index,
                _msgSender,
                uint128(_userFlowRate / 1e9),
                new bytes(0)
            ),
            new bytes(0),
            _ctx
        );
    }

    /**
     * @dev Function to close a stream
     * @dev This function should be called provided the app is jailed or user is running low on supertokens
     * @param _superToken The supertoken that the user is streaming
     * @param _user Address of the user
     */
    function emergencyCloseStream(ISuperToken _superToken, address _user)
        external
    {
        bool _close;

        // Check whether the app is jailed and if so, proceed with stream termination
        if (HOST.isAppJailed(ISuperApp(address(this)))) _close = true;
        else {
            int96 _flowRate = CFA_V1.getNetFlow(_superToken, _user);

            if (_flowRate < 0) {
                uint256 _balance = _superToken.balanceOf(_user);
                uint256 _positiveFlowRate = uint256(uint96(-1 * _flowRate));

                // if user has less liquidity ( <= 12 hours worth) close the stream
                if (_balance <= _positiveFlowRate * 12 hours) _close = true;
            }
        }

        if (_close) {
            HOST.callAgreement(
                CFA_V1,
                abi.encodeWithSelector(
                    CFA_V1.deleteFlow.selector,
                    _superToken,
                    _user,
                    address(this),
                    new bytes(0) // placeholder
                ),
                "0x"
            );
        } else revert("No emergency close");
    }

    /**
     * @dev Calculates uninvested amount of a user
     * @param _superToken Token being streamed
     * @param _user Address of the user
     * @param _lastDepositAt Last time a token was deposited to a dHEDGE pool
     * @return _userUninvested User's uninvested amount
     */
    function calcUserUninvested(
        ISuperToken _superToken,
        address _user,
        uint256 _lastDepositAt
    ) external view returns (uint256) {
        (uint256 _userPrevUpdateTimestamp, int96 _flowRate) = getFlow(
            _superToken,
            _user
        );
        uint256 _userFlowRate = uint256(uint96(_flowRate));

        return
            _userFlowRate *
            (block.timestamp -
                (
                    (_userPrevUpdateTimestamp > _lastDepositAt)
                        ? _userPrevUpdateTimestamp
                        : _lastDepositAt
                ));
    }

    /**
     *@notice Function to get the flow rate of a user
     * @param _superToken Address of the supertoken
     * @param _sender Address of the user
     * @return _timestamp Timestamp corresponding to previous stream rate update time
     * @return _flowRate Flow rate of a user
     */
    function getFlow(ISuperToken _superToken, address _sender)
        public
        view
        returns (uint256 _timestamp, int96 _flowRate)
    {
        (_timestamp, _flowRate, , ) = CFA_V1.getFlow(
            _superToken,
            _sender,
            address(this)
        );
    }
}
