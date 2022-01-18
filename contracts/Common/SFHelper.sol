// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {ISuperfluid, ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {IInstantDistributionAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IInstantDistributionAgreementV1.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "hardhat/console.sol";

/**
 * @title Superfluid helper library
 * @author rashtrakoff
 * @dev Contains functions which help with Superfluid streams related calculations
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable not-rely-on-time
library SFHelper {
    ISuperfluid public constant HOST =
        ISuperfluid(0x3E14dC1b13c488a8d5D310918780c983bD5982E7);
    IConstantFlowAgreementV1 public constant CFA_V1 =
        IConstantFlowAgreementV1(0x6EeE6060f715257b970700bc2656De21dEdF074C);
    IInstantDistributionAgreementV1 public constant IDA_V1 =
        IInstantDistributionAgreementV1(
            0xB0aABBA4B2783A72C52956CDEF62d438ecA2d7a1
        );

    // function createIndex(
    //     ISuperToken _superToken,
    //     uint32 _index
    // ) external returns (bytes memory _newCtx) {
    //     _newCtx = HOST.callAgreement(
    //         IDA_V1,
    //         abi.encodeWithSelector(
    //             IDA_V1.createIndex.selector,
    //             _superToken,
    //             _index,
    //             new bytes(0)
    //         ),
    //         new bytes(0) // user data
    //     );
    // }

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

        console.log("Actual amount distributed: %s", _actualAmount);
    }

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
    }

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
    ) external view returns (uint256 _userUninvested) {
        (uint256 _userPrevUpdateTimestamp, int96 _flowRate) = getFlow(
            _superToken,
            _user
        );
        uint256 _userFlowRate = uint256(uint96(_flowRate));

        _userUninvested =
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
     * @param _sender Address of the user
     * @param _superToken Address of the supertoken
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
