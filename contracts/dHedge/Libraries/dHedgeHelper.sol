// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {IPoolLogic, IPoolManagerLogic} from "../Interfaces/IdHedge.sol";
import {IdHedgeBank} from "../Interfaces/ISuperdHedge.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./dHedgeStorage.sol";
import "../../Common/SFHelper.sol";
import "hardhat/console.sol";

/**
 * @title dHedge helper library
 * @author rashtrakoff
 * @dev Contains functions for interacting with dHedge protocol pools
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable reason-string
// solhint-disable not-rely-on-time
// solhint-disable contract-name-camelcase
library dHedgeHelper {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;
    using SFHelper for *;

    event TokenDeposited(
        address _token,
        uint256 _tokenMarketIndex,
        uint256 _amount,
        uint256 _liquidityMinted
    );

    event LiquidityMoved(
        address _dHedgeCore,
        uint256 _amount,
        uint256 _timestamp
    );

    event LiquidityWithdrawn(
        address _dHedgeCore,
        address _user,
        uint256 _amount,
        uint256 _timestamp
    );

    event UninvestedWithdrawn(
        address _dHedgeCore,
        address _user,
        address _token,
        uint256 _amount
    );

    /**
     * @dev Function to deposit tokens into a dHedge pool
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * @custom:note Add code to collect fees later on.
     */
    function deposit(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _depositToken
    ) external {
        // Time difference between last deposit transaction and now
        uint256 _elapsedTime = block.timestamp - _dHedgePool.lastDepositTime;

        // If time elapsed between two token deposits is greater than 45 minutes then skip deposits till 24 hours are elapsed
        require(
            _elapsedTime <= 45 minutes || _elapsedTime >= 24 hours,
            "dHedgeHelper: Time difference exceeds limit"
        );

        IPoolLogic _poolLogic = IPoolLogic(_dHedgePool.poolLogic);
        IPoolManagerLogic _supportLogic = IPoolManagerLogic(
            _poolLogic.poolManagerLogic()
        );

        // Move the LP tokens accrued till previous deposit cycle if not done already
        moveLPT(_dHedgePool);

        // If the asset is currently accepted as deposit then perform deposit transaction
        if (_supportLogic.isDepositAsset(_depositToken)) {
            address _superToken = _dHedgePool
                .tokenData[_depositToken]
                .superToken;

            // Downgrade all supertokens to their underlying tokens
            _superToken._downgradeToken(
                IERC20(_superToken).balanceOf(address(this))
            );

            uint256 _depositBalance = IERC20(_depositToken).balanceOf(
                address(this)
            );

            // Perform deposit transaction iff amount of underlying tokens is greater than 0
            if (_depositBalance > 0) {
                // Get the current market index
                uint256 _prevIndex = _dHedgePool
                    .tokenData[_depositToken]
                    .currMarketIndex;

                // Get the current state of the market
                uint256[3] storage _prevState = _dHedgePool
                    .tokenData[_depositToken]
                    .lendingData[_prevIndex];

                // Array depicting future state of the market
                uint256[3] memory _currState;

                // Deposit the tokens into the dHedge pool
                uint256 _liquidityMinted = _poolLogic.deposit(
                    _depositToken,
                    _depositBalance
                );

                // Update the state of the market (total deposited, total lp minted, timestamp)
                _currState[0] = _prevState[0] + _depositBalance;
                _currState[1] = _prevState[1] + _liquidityMinted;
                _currState[2] = block.timestamp;

                _dHedgePool.tokenData[_depositToken].lendingData[
                    _prevIndex + 1
                ] = _currState;

                // Increment current token market index
                _dHedgePool.tokenData[_depositToken].currMarketIndex++;

                // Store the timestamp of last time a deposit was made in order to guard against long deposit intervals
                _dHedgePool.lastDepositTime = block.timestamp;

                emit TokenDeposited(
                    _depositToken,
                    _prevIndex + 1,
                    _depositBalance,
                    _liquidityMinted
                );
            }
        }
    }

    /**
     * @dev Function to move LP tokens to dHedgeBank contract in order to avoid timelock
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * Function should be directly callable by a dHedgeCore contract or owner of the contract
     */
    function moveLPT(dHedgeStorage.dHedgePool storage _dHedgePool) public {
        uint256 _balance = IERC20(_dHedgePool.poolLogic).balanceOf(
            address(this)
        );

        // Only execute this function if the balance of LP tokens is greater than 0 and
        // if the contract is not under active cooldown.
        if (
            _balance > 0 &&
            IPoolLogic(_dHedgePool.poolLogic).getExitRemainingCooldown(
                address(this)
            ) ==
            0
        ) {
            // Transfer the LP tokens minted in previous deposit cycles to dHedgeBank
            IdHedgeBank(_dHedgePool.bank).deposit(
                _dHedgePool.poolLogic,
                _balance
            );

            emit LiquidityMoved(address(this), _balance, block.timestamp);
        }
    }

    /**
     * @dev Function to withdraw a user's share of the pool
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * @param _amount Amount of LP tokens to be withdrawn to user's address
     */
    function withdrawLPT(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        uint256 _amount
    ) external {
        // If the LP tokens aren't already moved to bank, do so now
        moveLPT(_dHedgePool);

        // Calculating current withdrawable amount of LP tokens of a user.
        uint256 _withdrawableAmount = calcWithdrawable(_dHedgePool, msg.sender);

        if (_amount == type(uint256).max) _amount = _withdrawableAmount;

        // Prevent redeem amount greater than total share amount of the user
        require(
            _amount <= _withdrawableAmount,
            "dHedgeHelper: Withdraw amount exceeds limit"
        );

        // Add the redeemed amount to user's total redeemed amount
        _dHedgePool.redeemData[msg.sender] += _amount;

        // Transfer the required amount of LP tokens to the user
        IdHedgeBank(_dHedgePool.bank).withdraw(
            _dHedgePool.poolLogic,
            msg.sender,
            _amount
        );

        emit LiquidityWithdrawn(
            address(this),
            msg.sender,
            _amount,
            block.timestamp
        );
    }

    /**
     * @dev Function to withdraw all uninvested assets/tokens of a user from the dHedgeCore contract
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     */
    function withdrawUninvestedAll(dHedgeStorage.dHedgePool storage _dHedgePool)
        external
    {
        for (uint8 i = 0; i < _dHedgePool.tokenSet.length; ++i) {
            address _token = _dHedgePool.tokenSet[i];
            FlowData storage _userFlow = _dHedgePool
            .userFlows[msg.sender][_token].userFlow;
            uint256 _uninvestedAmount = calcUserUninvested(
                _dHedgePool,
                msg.sender,
                _token
            );

            if (_uninvestedAmount > 0) {
                // Uninvested amount should be made 0 and share amount needs to be updated
                _userFlow._updateFlowDetails(
                    0,
                    calcUserShare(_dHedgePool, msg.sender, _token)
                );

                IERC20(_dHedgePool.tokenData[_token].superToken).safeTransfer(
                    msg.sender,
                    _uninvestedAmount
                );

                emit UninvestedWithdrawn(
                    address(this),
                    msg.sender,
                    _token,
                    _uninvestedAmount
                );
            }
        }
    }

    /**
     * @dev Function to withdraw some amount of an uninvested asset/token of a user
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * @param _token Token to be withdrawn
     * @param _amount Amount from uninvested amount to be withdrawn
     */
    function withdrawUninvestedSingle(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _token,
        uint256 _amount
    ) external {
        uint256 _uninvestedAmount = calcUserUninvested(
            _dHedgePool,
            msg.sender,
            _token
        );

        require(
            _amount <= _uninvestedAmount,
            "dHedgeHelper: Amount is greater than limit"
        );

        FlowData storage _userFlow = _dHedgePool
        .userFlows[msg.sender][_token].userFlow;

        // Uninvested amount and share amount of the user needs to be updated
        _userFlow._updateFlowDetails(
            _uninvestedAmount - _amount,
            calcUserShare(_dHedgePool, msg.sender, _token)
        );

        IERC20(_dHedgePool.tokenData[_token].superToken).safeTransfer(
            msg.sender,
            _amount
        );

        emit UninvestedWithdrawn(
            address(this),
            msg.sender,
            _token,
            _uninvestedAmount
        );
    }

    /**
     * @dev Function which checks if deposit function can be called or not
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * @return boolean depicting need for upkeep
     * This function is useful for on-chain keepers
     */
    function requireUpkeep(dHedgeStorage.dHedgePool storage _dHedgePool)
        external
        view
        returns (bool, address)
    {
        // Time difference between last deposit transaction and now
        uint256 _elapsedTime = block.timestamp - _dHedgePool.lastDepositTime;

        // If time elapsed between two token deposits is greater than 45 minutes then skip deposits till 24 hours are elapsed
        if (
            (_elapsedTime <= 45 minutes || _elapsedTime >= 24 hours) &&
            _dHedgePool.isActive
        ) {
            IPoolLogic _poolLogic = IPoolLogic(_dHedgePool.poolLogic);
            IPoolManagerLogic _supportLogic = IPoolManagerLogic(
                _poolLogic.poolManagerLogic()
            );

            // Get assets currently supported by the dHedge pool
            address[] memory _depositAssets = _supportLogic.getDepositAssets();

            for (uint8 i = 0; i < _depositAssets.length; ++i) {
                address _depositToken = _depositAssets[i];
                address _superToken = _dHedgePool
                    .tokenData[_depositToken]
                    .superToken;

                // If supertoken for an underlying token exists then proceed with the deposit
                if (_superToken != address(0)) {
                    uint256 _currTokenIndex = _dHedgePool
                        .tokenData[_depositToken]
                        .currMarketIndex;

                    uint256 _lastLendingTimeDiff = block.timestamp -
                        _dHedgePool.tokenData[_depositToken].lendingData[
                            _currTokenIndex
                        ][2];

                    // If the deposit token hasn't been deposited in the last 24 hours then do so now
                    if (
                        _lastLendingTimeDiff >= 24 hours &&
                        IERC20(_superToken).balanceOf(address(this)) > 0
                    ) return (true, _depositToken);
                }
            }
        }

        return (false, address(0));
    }

    /**
     * @dev Function to calculate withdrawable amount of a user
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * @param _user Address of the user
     * @return Amount that can be fully withdrawn currently
     * This function accounts for the cooldown period so, real withdrawable amount can differ according
     * to the time of calling of this function.
     */
    function calcWithdrawable(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _user
    ) public view returns (uint256) {
        uint256 _totalShareAmount;

        for (uint256 i = 0; i < _dHedgePool.tokenSet.length; ++i) {
            address _depositToken = _dHedgePool.tokenSet[i];
            _totalShareAmount +=
                calcUserShare(_dHedgePool, _user, _depositToken) -
                calcUserLocked(_dHedgePool, _user, _depositToken);
        }

        // console.log("User's total withdrawable amount is: %s", _totalShareAmount - _dHedgePool.redeemData[_user]);

        return _totalShareAmount - _dHedgePool.redeemData[_user];
    }

    /**
     * @dev Function to calculate share amount received corresponding to token amount invested
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * @param _user Address of the user
     * @param _token Address of the token
     * Boolean representing if the calculation should be done with respect to withdrawal
     * @return User's share amount for an invested amount of a token
     * As this function is used to update total share amount of a user when updating his/her flow, it is
     * necessary to use a boolean depicting if the calculation is being done as a part of update flow or
     * as part of withdrawable calculation. For withdrawable calculation, it will account for cooldown period.
     */
    function calcUserShare(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _user,
        address _token
    )
        public
        view
        returns (
            // bool _withdraw
            uint256
        )
    {
        uint256 _shareAmount;
        FlowData storage _userFlow = _dHedgePool
        .userFlows[_user][_token].userFlow;

        // Entry index 0 means user has never used that token to invest
        if (_userFlow.updateIndex > 0) {
            // User's current flow rate
            uint256 _flowRate = _dHedgePool.cfa.getFlow(
                _user,
                _dHedgePool.tokenData[_token].superToken
            );

            uint256 _currIndex = _dHedgePool.tokenData[_token].currMarketIndex;
            console.log("Current index before checking - %s", _currIndex);

            // If the market has not lent after user's flow updation, return the share amount calculated previously
            if (_userFlow.updateIndex == _currIndex)
                _shareAmount = _userFlow.shareAmount;
            else {
                // Market state at the time of user's entry/updation
                uint256[3] storage _prevState = _dHedgePool
                    .tokenData[_token]
                    .lendingData[_userFlow.updateIndex];

                // Current market state
                uint256[3] storage _currState = _dHedgePool
                    .tokenData[_token]
                    .lendingData[_currIndex];

                // Add the user's share amount of the market
                _shareAmount = _userFlow.calcShare(
                    _token,
                    _flowRate,
                    _prevState[0],
                    _currState[0],
                    _prevState[1],
                    _currState[1],
                    _currState[2]
                );
            }

            // uint256 _lastLendingTimeDiff = block.timestamp -
            //     _dHedgePool.tokenData[_token].lendingData[_currIndex][2];

            // Account for cooldown period if calculating amounts for withdrawal
            // if (_withdraw) {
            //     _currIndex = (_lastLendingTimeDiff >= 24 hours)
            //         ? _currIndex
            //         : _currIndex - 1;

            //     console.log("Current index after checking - %s", _currIndex);
            // }
        }

        return _shareAmount;
    }

    /**
     * @dev Function to calculate uninvested amount of a token streamed by a user
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * @param _user Address of the user
     * @param _token Address of the token
     * @return User's uninvested amount of a token
     */
    function calcUserUninvested(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _user,
        address _token
    ) public view returns (uint256) {
        uint256 _uninvestedAmount;
        FlowData storage _userFlow = _dHedgePool
        .userFlows[_user][_token].userFlow;

        if (_userFlow.updateIndex > 0) {
            // User's current flow rate
            uint256 _flowRate = _dHedgePool.cfa.getFlow(
                _user,
                _dHedgePool.tokenData[_token].superToken
            );
            uint256 _currIndex = _dHedgePool.tokenData[_token].currMarketIndex;

            _uninvestedAmount = _userFlow.calcUserUninvested(
                _flowRate,
                _dHedgePool.tokenData[_token].lendingData[_currIndex][2]
            );
        }

        return _uninvestedAmount;
    }

    function calcUserLocked(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _user,
        address _token
    ) public view returns (uint256) {
        FlowData storage _userFlow = _dHedgePool
        .userFlows[_user][_token].userFlow;

        uint256 _userUpdateIndex = _userFlow.updateIndex;
        uint256 _marketIndex = _dHedgePool.tokenData[_token].currMarketIndex;

        if (
            IPoolLogic(_dHedgePool.poolLogic).getExitRemainingCooldown(
                address(this)
            ) ==
            0 ||
            block.timestamp -
                _dHedgePool.tokenData[_token].lendingData[_marketIndex][2] >
            24 hours
        ) return 0;
        else if (_userUpdateIndex >= _marketIndex)
            return _dHedgePool.userFlows[_user][_token].lockedShareAmount;
        else {
            uint256 _flowRate = _dHedgePool.cfa.getFlow(
                _user,
                _dHedgePool.tokenData[_token].superToken
            );
            uint256[3] memory _currState = _dHedgePool
                .tokenData[_token]
                .lendingData[_marketIndex];
            uint256[3] memory _prevState = _dHedgePool
                .tokenData[_token]
                .lendingData[_marketIndex - 1];

            if (_marketIndex - _userUpdateIndex >= 2) {
                console.log("Reaching here 1");
                return
                    ((_flowRate * (_currState[2] - _prevState[2])) *
                        (_currState[1] - _prevState[1])) /
                    (_currState[0] - _prevState[0]);
            } else {
                console.log("Reaching here 2");
                return
                    (_userFlow
                        .calcUserInvestedAfterUpdate(_flowRate, _currState[2])
                        .decimalAdjust(_token.getDecimals(), false) *
                        (_currState[1] - _prevState[1])) /
                    (_currState[0] - _prevState[0]);
            }
        }
    }

    /**
     * @dev Wrapper function to check if an asset is accepted as deposit asset in a dHedge pool
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * @param _token Address of the token to be deposited
     * @return Boolean representing the status of the token for deposition
     */
    function isDepositAsset(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _token
    ) public view returns (bool) {
        IPoolLogic _poolLogic = IPoolLogic(_dHedgePool.poolLogic);
        IPoolManagerLogic _supportLogic = IPoolManagerLogic(
            _poolLogic.poolManagerLogic()
        );

        return _supportLogic.isDepositAsset(_token);
    }
}
