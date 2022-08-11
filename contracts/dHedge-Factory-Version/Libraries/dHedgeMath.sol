// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.10;

import {IERC20Mod} from "../../Common/IERC20Mod.sol";
import "./dHedgeStorage.sol";
import "../../Common/SFHelper.sol";
import "hardhat/console.sol";

library dHedgeMath {
    using SFHelper for ISuperToken;

    /// Function to calculate buffer transfer amount before stream creation/updation.
    /// @param _dHedgePool Struct containing details regarding the pool and various tokens in it.
    /// @param _user Address of the user whose buffer transfer amount needs to be calculated.
    /// @param _superToken The supertoken address whose stream needs to be created/updated.
    /// @param _streamAction The type of stream modification (creation -> 1 and updation -> 2).
    /// @param _delay Useful in case transaction times are high as extra allowance can be taken.
    /// @param _flowRate Flow rate of the stream to be created/updated.
    /// @return The upfront fee to be taken or returned.
    /// @return Boolean representing if the upfront fee is taken or returned.
    function calcBufferTransferAmount(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _user,
        ISuperToken _superToken,
        uint8 _streamAction,
        uint64 _delay,
        int96 _flowRate
    ) public view returns (uint256, bool) {
        address _underlyingToken = _superToken.getUnderlyingToken();
        dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
            _underlyingToken
        ];
        uint256 _userUninvestedAmount = calcUserUninvested(
            _dHedgePool,
            _user,
            _superToken,
            _delay
        );

        // If a new stream needs to be created, calculate the buffer transfer amount required.
        // In this case, amount is transferred from the user.
        if (_streamAction == 1) {
            // Select the active index.
            dHedgeStorage.PermIndexData storage index = (tokenData
                .lockedIndexId == tokenData.permDistIndex1.indexId)
                ? tokenData.permDistIndex2
                : tokenData.permDistIndex1;

            // `_isTaken` value can be both true and false.
            // True if the user is not the first streamer and-
            // false in case the user is the first streamer.
            if (index.lastDepositAt == 0) return (0, false);

            return
                _calcBufferTransferAmount(
                    index.lastDepositAt,
                    _delay,
                    _flowRate,
                    _userUninvestedAmount
                );
        } else if (_streamAction == 2) {
            // If an existing stream is to be updated, the calculations are slightly different.
            // Upfront fee may be taken (in case new stream rate is > old stream rate) from the user or-
            // upfront fee may be returned (in case new stream rate < old stream rate).

            dHedgeStorage.PermIndexData storage currActiveIndex;

            // If distribution hasn't happened for the previous cycle then, select the unlocked index.
            // Else, select the assigned index of the user as the active index.
            // This is because the DHPT locked in the latest cycle has already been deposited and in such a-
            // case, index migration isn't necessary.
            if (tokenData.distAmount != 0) {
                currActiveIndex = (tokenData.lockedIndexId ==
                    tokenData.permDistIndex1.indexId)
                    ? tokenData.permDistIndex2
                    : tokenData.permDistIndex1;

                // If the unlocked index has no streamers, no upfront fee should be taken.
                // Calculation for the same should consider `lastDepositAt` = `block.timestamp`.
                if (currActiveIndex.lastDepositAt == 0) {
                    return (_userUninvestedAmount, false);
                }
            } else {
                currActiveIndex = (tokenData.assignedIndex[_user] ==
                    tokenData.permDistIndex1.indexId)
                    ? tokenData.permDistIndex1
                    : tokenData.permDistIndex2;
            }

            return
                _calcBufferTransferAmount(
                    currActiveIndex.lastDepositAt,
                    _delay,
                    _flowRate,
                    _userUninvestedAmount
                );
        } else {
            revert("dHedgeHelper: Invalid stream action");
        }
    }

    /// Function to calculate uninvested amount of a user to return that after stream updation/termination.
    /// @param _dHedgePool Struct containing details regarding the pool and various tokens in it.
    /// @param _user Address of the user whose uninvested amount has to be calculated.
    /// @param _superToken Address of the underlying token (deposit token and not the supertoken).
    /// @return Amount representing user's uninvested amount.
    function calcUserUninvested(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _user,
        ISuperToken _superToken,
        uint64 _delay
    ) public view returns (uint256) {
        /// @dev Note: when no streams are present then tokenData[_depositToken] returns null address.
        dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
            _superToken.getUnderlyingToken()
        ];

        if (address(tokenData.superToken) == address(0)) return 0;

        (
            ,
            /* uint256 _userPrevUpdateTimestamp */
            int96 _flowRate
        ) = _superToken.getFlow(_user);
        uint256 _userFlowRate = uint256(uint96(_flowRate));

        return
            _userFlowRate *
            (block.timestamp +
                _delay -
                (
                    (tokenData.assignedIndex[_user] ==
                        tokenData.permDistIndex1.indexId)
                        ? tokenData.permDistIndex1.lastDepositAt
                        : tokenData.permDistIndex2.lastDepositAt
                ));
    }

    function _calcBufferTransferAmount(
        ISuperToken _superToken,
        address _sender,
        uint64 _lastDepositAt,
        uint64 _delay,
        uint256 _userUninvested
    ) internal view returns (uint256 _transferAmount, bool _isTaken) {
        (, int96 _flowRate) = _superToken.getFlow(_sender);

        (_transferAmount, _isTaken) = _calcBufferTransferAmount(
            _lastDepositAt,
            _delay,
            _flowRate,
            _userUninvested
        );
    }

    function _calcBufferTransferAmount(
        uint64 _lastDepositAt,
        uint64 _delay,
        int96 _flowRate,
        uint256 _userUninvested
    ) internal view returns (uint256 _transferAmount, bool _isTaken) {
        console.log(
            "Delay: %s, lastDeposit: %s, flowRate: %s",
            _delay,
            _lastDepositAt,
            uint256(uint96(_flowRate))
        );

        // Calculate how much amount needs to be deposited upfront.
        uint256 _depositAmount = (block.timestamp + _delay - _lastDepositAt) *
            uint256(uint96(_flowRate));

        console.log(
            "Deposit amount: %s, Uninvested: %s",
            _depositAmount,
            _userUninvested
        );

        // If amount to be deposited is greater than user's uninvested amount then,
        // transfer the difference from the user.
        if (_depositAmount > _userUninvested) {
            _transferAmount = _depositAmount - _userUninvested;
            _isTaken = true;
        } else if (_depositAmount < _userUninvested) {
            // Else if the amount to be deposited is lesser than the uninvested amount, transfer-
            // the difference to the user.
            _transferAmount = _userUninvested - _depositAmount;
            _isTaken = false;
        }
    }
}
