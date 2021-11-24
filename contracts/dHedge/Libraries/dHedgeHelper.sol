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
// solhint-disable contract-name-camelcase
library dHedgeHelper {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;
    using SFHelper for *;

    event TokenDeposited(
        address _token,
        uint256 _amount,
        uint256 _liquidityMinted
    );
    event FundsDeposited(address _dHedgeCore, uint256 _currIndex, uint256 _timestamp);

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
     * @dev Add code to collect fees later on.
     * Doesn't deposit an asset which isn't currently accepted as deposit asset.
     * This function can exceed gas limits if there are a lot of tokens to be deposited.
     * Consider making a function which deposits one token at a time and automate the deposits using keepers.
     * This way we won't have to worry about keeper failing to execute the deposit function.
     */
    function deposit(dHedgeStorage.dHedgePool storage _dHedgePool) external {
        IPoolLogic _poolLogic = IPoolLogic(_dHedgePool.poolLogic);
        IPoolManagerLogic _supportLogic = IPoolManagerLogic(
            _poolLogic.poolManagerLogic()
        );

        require(
            _poolLogic.getExitRemainingCooldown(address(this)) == 0,
            "dHedgeHelper: Cooldown active"
        );

        // Move the LP tokens accrued till previous deposit cycle if not done already
        moveLPT(_dHedgePool);

        for (uint8 i = 0; i < _dHedgePool.tokenSet.length(); ++i) {
            address _depositToken = _dHedgePool.tokenSet.at(i);

            // If the asset is currently accepted as deposit then perform deposit transaction
            if (_supportLogic.isDepositAsset(_depositToken)) {
                address _superToken = _dHedgePool.superToken[_depositToken];

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
                    uint256 _prevIndex = _dHedgePool.currIndex;

                    // Get the current state of the market
                    uint256[3] storage _prevState = _dHedgePool.lendingData[
                        _prevIndex
                    ][_depositToken];

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
                    _currState[2] = block.timestamp; // solhint-disable-line not-rely-on-time

                    _dHedgePool.lendingData[_prevIndex + 1][
                        _depositToken
                    ] = _currState;

                    emit TokenDeposited(
                        _depositToken,
                        _depositBalance,
                        _liquidityMinted
                    );
                }
            }
        }

        // Update current market index
        ++_dHedgePool.currIndex;

        emit FundsDeposited(
            address(this),
            _dHedgePool.currIndex,
            block.timestamp // solhint-disable-line not-rely-on-time
        );
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

            emit LiquidityMoved(
                address(this),
                _balance,
                block.timestamp // solhint-disable-line not-rely-on-time
            );
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
            block.timestamp // solhint-disable-line not-rely-on-time
        );
    }

    /**
     * @dev Function to withdraw all uninvested assets/tokens of a user from the dHedgeCore contract
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     */
    function withdrawUninvestedAll(dHedgeStorage.dHedgePool storage _dHedgePool)
        external
    {
        for (uint8 i = 0; i < _dHedgePool.tokenSet.length(); ++i) {
            address _token = _dHedgePool.tokenSet.at(i);
            FlowData storage _userFlow = _dHedgePool.userFlows[msg.sender][
                _token
            ];
            uint256 _uninvestedAmount = calcUserUninvested(
                _dHedgePool,
                msg.sender,
                _token
            );

            if (_uninvestedAmount > 0) {
                // Uninvested amount should be made 0 and share amount needs to be updated
                _userFlow._updateFlowDetails(
                    0,
                    calcUserShare(_dHedgePool, msg.sender, _token, false)
                );

                IERC20(_dHedgePool.superToken[_token]).safeTransfer(
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

        FlowData storage _userFlow = _dHedgePool.userFlows[msg.sender][_token];

        // Uninvested amount and share amount of the user needs to be updated
        _userFlow._updateFlowDetails(
            _uninvestedAmount - _amount,
            calcUserShare(_dHedgePool, msg.sender, _token, false)
        );

        IERC20(_dHedgePool.superToken[_token]).safeTransfer(
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
        returns (bool)
    {
        IPoolLogic _poolLogic = IPoolLogic(_dHedgePool.poolLogic);
        IPoolManagerLogic _supportLogic = IPoolManagerLogic(
            _poolLogic.poolManagerLogic()
        );

        for (uint256 i = 0; i < _dHedgePool.tokenSet.length(); ++i) {
            address _depositToken = _dHedgePool.tokenSet.at(i);
            if (_supportLogic.isDepositAsset(_depositToken)) {
                address _superToken = _dHedgePool.superToken[_depositToken];

                if (
                    IERC20(_superToken).balanceOf(address(this)) > 0 &&
                    _poolLogic.getExitRemainingCooldown(address(this)) == 0
                ) return true;
            }
        }

        return false;
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

        for (uint8 i = 0; i < _dHedgePool.tokenSet.length(); ++i) {
            address _depositToken = _dHedgePool.tokenSet.at(i);
            _totalShareAmount += calcUserShare(
                _dHedgePool,
                _user,
                _depositToken,
                true
            );
        }

        // console.log("User's total withdrawable amount is: %s", _totalShareAmount - _dHedgePool.redeemData[_user]);

        return _totalShareAmount - _dHedgePool.redeemData[_user];
    }

    /**
     * @dev Function to calculate share amount received corresponding to token amount invested
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * @param _user Address of the user
     * @param _token Address of the token
     * @param _withdraw Boolean representing if the calculation should be done with respect to withdrawal
     * @return User's share amount for an invested amount of a token
     * As this function is used to update total share amount of a user when updating his/her flow, it is
     * necessary to use a boolean depicting if the calculation is being done as a part of update flow or
     * as part of withdrawable calculation. For withdrawable calculation, it will account for cooldown period.
     */
    function calcUserShare(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _user,
        address _token,
        bool _withdraw
    ) public view returns (uint256) {
        uint256 _shareAmount;
        FlowData storage _userFlow = _dHedgePool.userFlows[_user][_token];

        // Entry index 0 means user has never used that token to invest
        if (_userFlow.updateIndex > 0) {
            // User's current flow rate
            uint256 _flowRate = _dHedgePool.cfa.getFlow(
                _user,
                _dHedgePool.superToken[_token]
            );

            uint256 _currIndex;
            // Account for cooldown period if calculating amounts for withdrawal
            if (_withdraw == true) {
                // solhint-disable-next-line not-rely-on-time
                _currIndex = (block.timestamp -
                    _dHedgePool.lendingData[_dHedgePool.currIndex][_token][2] >=
                    24 hours)
                    ? _dHedgePool.currIndex
                    : _dHedgePool.currIndex - 1;
            } else {
                _currIndex = _dHedgePool.currIndex;
            }

            // Market state at the time of user's entry
            uint256[3] storage _prevState = _dHedgePool.lendingData[
                _userFlow.updateIndex
            ][_token];

            // Current market state
            uint256[3] storage _currState = _dHedgePool.lendingData[_currIndex][
                _token
            ];

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
        FlowData storage _userFlow = _dHedgePool.userFlows[_user][_token];

        if (_userFlow.updateIndex > 0) {
            // User's current flow rate
            uint256 _flowRate = _dHedgePool.cfa.getFlow(
                _user,
                _dHedgePool.superToken[_token]
            );

            _uninvestedAmount = _userFlow.calcUserUninvested(
                _flowRate,
                _dHedgePool.lendingData[_dHedgePool.currIndex][_token][2]
            );
        }

        return _uninvestedAmount;
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
