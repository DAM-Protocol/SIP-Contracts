// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.10;

import { ISuperfluid, ISuperToken, ISuperAgreement, ISuperApp } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import { IConstantFlowAgreementV1 } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import { IInstantDistributionAgreementV1 } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IInstantDistributionAgreementV1.sol";

import "hardhat/console.sol";

/**
 * @title Superfluid helper library.
 * @author rashtrakoff <rashtrakoff@pm.me>.
 * @dev Contains functions which help in interacting with Superfluid contracts.
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable not-rely-on-time
library SFHelper {
    event NewSupertokenAdded(address _superToken, uint32 _index);
    event NewTemporaryIndexCreated(address _superToken, uint32 _index);

    // Mainnet contract addresses.
    // ISuperfluid public constant HOST =
    //     ISuperfluid(0x3E14dC1b13c488a8d5D310918780c983bD5982E7);
    // IConstantFlowAgreementV1 public constant CFA_V1 =
    //     IConstantFlowAgreementV1(0x6EeE6060f715257b970700bc2656De21dEdF074C);
    // IInstantDistributionAgreementV1 public constant IDA_V1 =
    //     IInstantDistributionAgreementV1(
    //         0xB0aABBA4B2783A72C52956CDEF62d438ecA2d7a1
    //     );

    // Mumbai testnet addresses.
    // ISuperfluid public constant HOST =
    //     ISuperfluid(0xEB796bdb90fFA0f28255275e16936D25d3418603);
    // IConstantFlowAgreementV1 public constant CFA_V1 =
    //     IConstantFlowAgreementV1(0x49e565Ed1bdc17F3d220f72DF0857C26FA83F873);
    // IInstantDistributionAgreementV1 public constant IDA_V1 =
    //     IInstantDistributionAgreementV1(
    //         0x804348D4960a61f2d5F9ce9103027A3E849E09b8
    //     );

    // Addresses for local testing.
    /// @dev Note: The addresses change for each test file. Don't run all the tests using `hh test`.
    /// Run each test file individually after getting the address from the `SFSetup.js`.
    ISuperfluid public constant HOST =
        ISuperfluid(0x0165878A594ca255338adfa4d48449f69242Eb8F);
    IConstantFlowAgreementV1 public constant CFA_V1 =
        IConstantFlowAgreementV1(0x610178dA211FEF7D417bC0e6FeD39F05609AD788);
    IInstantDistributionAgreementV1 public constant IDA_V1 =
        IInstantDistributionAgreementV1(
            0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82
        );

    /// Function to distribute a supertoken amount according to an index.
    /// @param _superToken The supertoken to be distributed.
    /// @param _index Index containing share details.
    /// @param _amount Amount of `_supertoken` to be distributed.
    function distribute(
        ISuperToken _superToken,
        uint32 _index,
        uint256 _amount
    ) external returns (bytes memory _newCtx) {
        // console.log(
        //     "Amount to distribute: %s, Index: %s, DHPTx: %s",
        //     _amount,
        //     _index,
        //     _superToken.balanceOf(address(this))
        // );
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

    /// Function to create a distribution index.
    /// @param _superToken The supertoken to be distributed.
    /// @param _index New index value containing share details.
    function createIndex(ISuperToken _superToken, uint32 _index)
        external
        returns (bytes memory _newCtx)
    {
        _newCtx = HOST.callAgreement(
            IDA_V1,
            abi.encodeWithSelector(
                IDA_V1.createIndex.selector,
                _superToken,
                _index,
                new bytes(0) // placeholder ctx
            ),
            new bytes(0) // userData
        );

        emit NewSupertokenAdded(address(_superToken), _index);
    }

    /// Function to create a distribution index.
    /// @param _superToken The supertoken to be distributed.
    /// @param _index New index value containing share details.
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

        emit NewTemporaryIndexCreated(address(_superToken), _index);
    }

    /// @dev Function to update shares of a user.
    /// @param _superStreamToken The supertoken that the user is streaming.
    /// @param _superDistToken The supertoken that's distributed in index with value `_index`.
    /// @param _index Index containing share details.
    /// @param _ctx Superfluid context object.
    function updateSharesInCallback(
        ISuperToken _superStreamToken,
        ISuperToken _superDistToken,
        uint32 _index,
        address _user,
        bytes calldata _ctx
    ) external returns (bytes memory _newCtx) {
        // address _msgSender = HOST.decodeCtx(_ctx).msgSender;
        (, int96 _flowRate) = getFlow(_superStreamToken, _user);
        uint256 _userFlowRate = uint256(uint96(_flowRate));

        (_newCtx, ) = HOST.callAgreementWithContext(
            IDA_V1,
            abi.encodeWithSelector(
                IDA_V1.updateSubscription.selector,
                _superDistToken,
                _index,
                _user,
                uint128(_userFlowRate / 1e9),
                new bytes(0)
            ),
            new bytes(0),
            _ctx
        );
    }

    /// To be used when assigning shares in a temporary index.
    /// @param _superDistToken Distribution supertoken.
    /// @param _index Index ID in which shares need to be updated.
    /// @param _units Number of units to be assigned.
    /// @param _ctx Superfluid context object.
    function updateSharesInCallback(
        ISuperToken _superDistToken,
        uint32 _index,
        uint128 _units,
        address _user,
        bytes calldata _ctx
    ) external returns (bytes memory _newCtx) {
        // address _msgSender = HOST.decodeCtx(_ctx).msgSender;

        (_newCtx, ) = HOST.callAgreementWithContext(
            IDA_V1,
            abi.encodeWithSelector(
                IDA_V1.updateSubscription.selector,
                _superDistToken,
                _index,
                _user,
                _units,
                new bytes(0)
            ),
            new bytes(0),
            _ctx
        );
    }

    function deleteSubscriptionInCallback(
        ISuperToken _superToken,
        uint32 _index,
        address _user,
        bytes calldata _ctx
    ) external returns (bytes memory _newCtx) {
        // address _msgSender = HOST.decodeCtx(_ctx).msgSender;

        (_newCtx, ) = HOST.callAgreementWithContext(
            IDA_V1,
            abi.encodeWithSelector(
                IDA_V1.deleteSubscription.selector,
                _superToken,
                address(this),
                _index,
                _user,
                new bytes(0)
            ),
            new bytes(0),
            _ctx
        );
    }

    /// Function to close a stream.
    /// @dev This function should be called provided the app is jailed or user is running low on supertokens.
    /// @param _superToken The supertoken that the user is streaming
    /// @param _user Address of the user
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

                // console.log("Balance: %s, +flowRate: %s", _balance, _positiveFlowRate);

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
        } else revert("SFHelper: No emergency close");
    }

    /// Function to get an index's details.
    /// @param _superToken Supertoken of the corresponding index.
    /// @param _indexId ID of the index whose details we require.
    function getIndex(ISuperToken _superToken, uint32 _indexId)
        external
        view
        returns (
            bool _exist,
            uint128 _indexValue,
            uint128 _totalUnitsApproved,
            uint128 _totalUnitsPending
        )
    {
        return IDA_V1.getIndex(_superToken, address(this), _indexId);
    }

    /// Function to get details of a user's subscription (IDA subscription).
    /// @param _superToken Supertoken of the corresponding index.
    /// @param _index ID of the index in which the user's subscription is present.
    /// @param _user Address of the user whose subscription details we need.
    function getSubscription(
        ISuperToken _superToken,
        uint32 _index,
        address _user
    )
        external
        view
        returns (
            bool _exist,
            bool _approved,
            uint128 _units,
            uint256 _pendingDistribution
        )
    {
        return
            IDA_V1.getSubscription(_superToken, address(this), _index, _user);
    }

    /// Function to get the flow rate of a user.
    /// @param _superToken Address of the supertoken.
    /// @param _sender Address of the user.
    /// @return _timestamp Timestamp corresponding to previous stream rate update time.
    /// @return _flowRate Flow rate of a user.
    function getFlow(ISuperToken _superToken, address _sender)
        public
        view
        returns (uint256 _timestamp, int96 _flowRate)
    {
        // console.log("Reached getFlow");
        // console.log("Supertoken: %s, Sender: %s, This: %s", address(_superToken), _sender, address(this));

        (_timestamp, _flowRate, , ) = CFA_V1.getFlow(
            _superToken,
            _sender,
            address(this)
        );
    }

    /// Checks if the caller is the SF host contract.
    function _onlyHost() internal view {
        require(
            msg.sender == address(HOST),
            "SFHelper: Supports only one host"
        );
    }
}
