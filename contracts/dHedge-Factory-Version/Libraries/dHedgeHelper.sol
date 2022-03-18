// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import { IPoolLogic, IPoolManagerLogic } from "../Interfaces/IdHedge.sol";
import { IdHedgeCoreFactory } from "../Interfaces/IdHedgeCoreFactory.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./dHedgeStorage.sol";
import "../../Common/SFHelper.sol";
import "hardhat/console.sol";

/**
 * @title Modified IERC20 interface
 * @dev This interface is used to access decimals of an ERC20 token
 */
interface IERC20Mod is IERC20 {
    function decimals() external view returns (uint8);
}

/**
 * @title dHedge helper library
 * @author rashtrakoff <rashtrakoff@pm.me>
 * @dev Contains functions for interacting with dHedge protocol pools
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable reason-string
// solhint-disable not-rely-on-time
// solhint-disable contract-name-camelcase
library dHedgeHelper {
    using SafeERC20 for IERC20;
    using SFHelper for ISuperToken;

    event TokenDeposited(
        address token,
        uint256 amount,
        uint256 liquidityMinted
    );
    event UpfrontFeeReturned(
        ISuperToken superToken,
        address sender,
        uint256 amount
    );
    event UpfrontFeeDeposited(
        ISuperToken superToken,
        address sender,
        uint256 amount
    );

    function initStreamToken(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        ISuperToken _superToken
    ) external {
        address _underlyingToken = _superToken.getUnderlyingToken();
        dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
            _underlyingToken
        ];

        require(
            address(tokenData.superToken) == address(0),
            "dHedgeHelper: Token already present"
        );

        // Create 2 permanent indexes in accordance with `3-index` approach
        if (address(tokenData.superToken) == address(0)) {
            uint32 _latestDistIndex = _dHedgePool.latestDistIndex;
            tokenData.permDistIndex1 = _latestDistIndex;
            tokenData.permDistIndex2 = _latestDistIndex + 1;

            // We will start the stream of the supertoken using index 1 and hence, index 2 is locked.
            tokenData.lockedIndexId = _latestDistIndex + 1;
            _dHedgePool.latestDistIndex += 2;

            tokenData.superToken = _superToken;

            // To calculate amount streamed after deployment but before first deposit
            tokenData.lastDepositAt = uint64(block.timestamp);

            // console.log(
            //     "Index for token %s: %s",
            //     _underlyingToken,
            //     tokenData.distIndex
            // );

            bytes memory _newCtx = _dHedgePool.DHPTx.createIndex(
                _latestDistIndex
            );

            _newCtx = _dHedgePool.DHPTx.createIndex(_latestDistIndex + 1);

            // Unlimited allowance for the dHEDGE pool so that deposits can take place efficiently
            IERC20(_underlyingToken).safeIncreaseAllowance(
                _dHedgePool.poolLogic,
                type(uint256).max
            );
        }
    }

    /**
     * @dev Function to deposit tokens into a dHedge pool
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * @param _depositToken Address of the underlying token (deposit token and not the supertoken)
     */
    function deposit(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _depositToken
    ) external {
        require(
            (block.timestamp -
                _dHedgePool.tokenData[_depositToken].lastDepositAt) > 24 hours,
            "dHedgeHelper: Less than 24 hours"
        );

        IPoolLogic _poolLogic = IPoolLogic(_dHedgePool.poolLogic);
        IPoolManagerLogic _supportLogic = IPoolManagerLogic(
            _poolLogic.poolManagerLogic()
        );

        // If the asset is currently accepted as deposit then perform deposit transaction
        if (_supportLogic.isDepositAsset(_depositToken)) {
            dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
                _depositToken
            ];

            ISuperToken _DHPTx = _dHedgePool.DHPTx;
            {
                (
                    ,
                    ,
                    uint128 _totalLockedIndexApprovedUnits1,
                    uint128 _totalLockedIndexPendingUnits1
                ) = _DHPTx.getIndex(tokenData.permDistIndex1);

                (
                    ,
                    ,
                    uint128 _totalLockedIndexApprovedUnits2,
                    uint128 _totalLockedIndexPendingUnits2
                ) = _DHPTx.getIndex(tokenData.permDistIndex2);

                uint128 _totalLockedIndexUnits1 = _totalLockedIndexApprovedUnits1 +
                        _totalLockedIndexPendingUnits1;

                uint128 _totalLockedIndexUnits2 = _totalLockedIndexApprovedUnits2 +
                        _totalLockedIndexPendingUnits2;

                uint256 _superTokenDepositBalance = ((
                    (tokenData.lockedIndexId == tokenData.permDistIndex2)
                        ? _totalLockedIndexUnits1
                        : _totalLockedIndexUnits2
                ) * tokenData.superToken.balanceOf(address(this))) /
                    _totalLockedIndexUnits2 +
                    _totalLockedIndexUnits1;

                // uint256 _superTokenDepositBalance = ((
                //     (tokenData.lockedIndexId == tokenData.permDistIndex2)
                //         ? _totalLockedIndexApprovedUnits1 +
                //             _totalLockedIndexPendingUnits1
                //         : _totalLockedIndexApprovedUnits2 +
                //             _totalLockedIndexPendingUnits2
                // ) * tokenData.superToken.balanceOf(address(this))) /
                //     (_totalLockedIndexApprovedUnits2 +
                //         _totalLockedIndexPendingUnits2 +
                //         _totalLockedIndexApprovedUnits1 +
                //         _totalLockedIndexPendingUnits1);

                // Downgrade amount of supertoken required for deposit.
                tokenData.superToken.downgrade(_superTokenDepositBalance);
            }

            uint256 _depositBalance = IERC20Mod(_depositToken).balanceOf(
                address(this)
            );

            // Calculate fee to be collected.
            uint256 _feeCollected = (_depositBalance *
                IdHedgeCoreFactory(_dHedgePool.factory).defaultFeeRate()) / 1e6;

            _depositBalance -= _feeCollected;

            // TODO: Distribute the locked DHPT and then deposit into dHEDGE pool.

            // Perform deposit transaction iff amount of underlying tokens is greater than 0
            if (_depositBalance > 0) {
                // Store the timestamp of last time a deposit & distribution was made
                tokenData.lastDepositAt = uint64(block.timestamp);

                // Transfer the fees collected to the owner only if it's greater than 0.
                // This can happen if `defaultFeeRate` is set as 0.
                if (_feeCollected > 0) {
                    IERC20(_depositToken).safeTransfer(
                        IdHedgeCoreFactory(_dHedgePool.factory).dao(),
                        _feeCollected
                    );
                }

                // Deposit the tokens into the dHedge pool
                uint256 _liquidityMinted = _poolLogic.deposit(
                    _depositToken,
                    _depositBalance
                );

                // Following console logs are required for manual verification of some tests
                // console.log(
                //     "Liquidity minted for token %s: %s",
                //     _depositToken,
                //     _liquidityMinted
                // );

                // console.log(
                //     "Fee collected for token %s: %s",
                //     _depositToken,
                //     _feeCollected
                // );

                emit TokenDeposited(
                    _depositToken,
                    _depositBalance,
                    _liquidityMinted
                );
            }
        }
    }

    /**
     * @dev Helper function that's called after agreements are created, updated or terminated
     * @param _agreementClass Address of the agreement calling this function
     * @param _underlyingToken Address of the underlying token on which operations need to be performed
     * @param _ctx Superfluid context object
     * @param _cbdata Callback data we passed before agreement was created, updated or terminated
     * @param _newCtx New Superfluid context object
     */
    function afterAgreement(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _sender,
        address _agreementClass,
        address _underlyingToken,
        bytes memory _ctx,
        bytes memory _cbdata
    ) external returns (bytes memory _newCtx) {
        _newCtx = _ctx;

        if (
            ISuperAgreement(_agreementClass).agreementType() ==
            keccak256(
                "org.superfluid-finance.agreements.ConstantFlowAgreement.v1"
            )
        ) {
            uint256 _userUninvested = abi.decode(_cbdata, (uint256));

            // Should this be a storage pointer ?
            dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
                _underlyingToken
            ];
            ISuperToken _superToken = tokenData.superToken;
            ISuperToken _DHPTx = _dHedgePool.DHPTx;

            {
                (, int96 _flowRate) = _superToken.getFlow(_sender);
                uint256 _currFlowRate = uint256(uint96(_flowRate));

                assert(_userUninvested <= _superToken.balanceOf(address(this)));

                // Return some amount if previous flow rate was higher than the current one after update
                uint256 _depositAmount = (block.timestamp -
                    tokenData.lastDepositAt) * _currFlowRate;

                bool success;
                if (_depositAmount > _userUninvested) {
                    // console.log("Reached here 1");
                    uint256 _amount = _depositAmount - _userUninvested;

                    success = _superToken.transferFrom(
                        _sender,
                        address(this),
                        _amount
                    );

                    emit UpfrontFeeDeposited(_superToken, _sender, _amount);
                } else if (_depositAmount < _userUninvested) {
                    // console.log("Reached here 2");
                    uint256 _amount = _userUninvested - _depositAmount;

                    success = _superToken.transfer(_sender, _amount);

                    emit UpfrontFeeReturned(_superToken, _sender, _amount);
                }

                require(success, "dHedgeHelper: Buffer transfer failed");
            }

            {
                uint32 _lockedIndexId = tokenData.lockedIndexId;

                // First permanent index id is always an even number as we start from 0.
                // Second permanent index id is always an odd number for the same reason.
                uint32 _currActiveIndex = (_lockedIndexId ==
                    tokenData.permDistIndex1)
                    ? tokenData.permDistIndex2
                    : tokenData.permDistIndex1;

                uint32 _assignedIndex = tokenData.assignedIndex[_sender];

                // If current active index and assigned index are not same and assigned index is not 0
                // then we will have to initiate index migration.
                if (
                    (_assignedIndex != _currActiveIndex) && _assignedIndex != 0
                ) {
                    // Index migration is done by deleting a sender's subscription in the locked index
                    // and assigning new units in the active index along with assigning new units in temporary
                    // index.

                    (, , uint128 _userUnits, ) = _DHPTx.getSubscription(
                        _lockedIndexId,
                        _sender
                    );

                    (
                        ,
                        ,
                        uint128 _totalLockedIndexApprovedUnits,
                        uint128 _totalLockedIndexPendingUnits
                    ) = _DHPTx.getIndex(_lockedIndexId);

                    // Calculating a user's pending locked tokens amount by using units issued to the user,
                    // total units issued and total amount of DHPT in this contract (this is the locked amount)
                    tokenData.tempDistAmount +=
                        (_userUnits * _DHPTx.balanceOf(address(this))) /
                        (_totalLockedIndexApprovedUnits +
                            _totalLockedIndexPendingUnits);

                    // Deleting units of the user in locked index
                    _newCtx = _DHPTx.deleteSubscriptionInCallback(
                        _lockedIndexId,
                        _newCtx
                    );

                    // Assigning units in temporary index
                    _newCtx = _DHPTx.updateSharesInCallback(
                        tokenData.tempDistIndex,
                        _userUnits,
                        _newCtx
                    );
                }

                // Assigning new units in the active index
                _newCtx = _superToken.updateSharesInCallback(
                    _DHPTx,
                    _currActiveIndex,
                    _newCtx
                );
            }
        }
    }

    /**
     * @dev Helper function that's called before agreements are created, updated or terminated
     * @param _agreementClass Address of the agreement calling this function
     * @param _underlyingToken Address of the underlying token on which operations need to be performed
     * @param _ctx Context data of a user provided by SF contract
     * @return _cbdata Callback data that needs to be passed on to _afterAgreementCFA function
     */
    function beforeAgreement(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _agreementClass,
        address _underlyingToken,
        bytes memory _ctx
    ) external view returns (bytes memory _cbdata) {
        _cbdata = new bytes(0);

        if (
            ISuperAgreement(_agreementClass).agreementType() ==
            keccak256(
                "org.superfluid-finance.agreements.ConstantFlowAgreement.v1"
            )
        ) {
            address _sender = SFHelper.HOST.decodeCtx(_ctx).msgSender;

            _cbdata = abi.encode(
                calcUserUninvested(_dHedgePool, _sender, _underlyingToken)
            );
        }
    }

    /**
     * @dev Function which checks if deposit function can be called or not
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * @return _reqUpkeep Boolean depicting need for upkeep
     * @return _depositToken Address of the underlying token (deposit token and not the supertoken)
     * This function is useful for on-chain keepers. Deposit function should only be called if `_reqUpkeep` is true
     * let whatever be the address of the `_depositToken`
     */
    function requireUpkeep(dHedgeStorage.dHedgePool storage _dHedgePool)
        external
        view
        returns (bool _reqUpkeep, address _depositToken)
    {
        if (_dHedgePool.isActive) {
            IPoolLogic _poolLogic = IPoolLogic(_dHedgePool.poolLogic);
            IPoolManagerLogic _supportLogic = IPoolManagerLogic(
                _poolLogic.poolManagerLogic()
            );

            // Get assets currently supported by the dHedge pool
            address[] memory _depositAssets = _supportLogic.getDepositAssets();

            for (uint8 i = 0; i < _depositAssets.length; ++i) {
                _depositToken = _depositAssets[i];
                dHedgeStorage.TokenData storage tokenData = _dHedgePool
                    .tokenData[_depositToken];

                // If supertoken for an underlying token exists then proceed with the deposit
                if (
                    address(tokenData.superToken) != address(0) &&
                    (block.timestamp - tokenData.lastDepositAt) >= 24 hours
                ) {
                    uint256 _depositBalance = tokenData.superToken.balanceOf(
                        address(this)
                    ) / (10**(18 - IERC20Mod(_depositToken).decimals()));

                    if (_depositBalance > 0) return (true, _depositToken);
                }
            }
        }

        return (false, address(0));
    }

    /**
     * @dev Function to calculate uninvested amount of a user to return that after stream updation/termination
     * @param _dHedgePool Struct containing details regarding the pool and various tokens in it
     * @param _user Address of the user whose uninvested amount has to be calculated
     * @param _depositToken Address of the underlying token (deposit token and not the supertoken)
     * @return Amount representing user's uninvested amount
     */
    function calcUserUninvested(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _user,
        address _depositToken
    ) public view returns (uint256) {
        dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
            _depositToken
        ];

        return
            tokenData.superToken.calcUserUninvested(
                _user,
                tokenData.lastDepositAt
            );
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
