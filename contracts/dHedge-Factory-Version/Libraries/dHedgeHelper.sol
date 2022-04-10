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

// Note: Required to check if distribution indices indeed exist or not when making deposits or distributions.

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
    event IndexMigrated(uint32 prevIndexId, uint32 tempIndexId);

    /// Initialise a market for a new token.
    /// This means, create 3 indices (2 permanent and 1 temporary) along with unlimited approval-
    /// for the underlying token to the dHEDGE pool.
    /// @param _dHedgePool Struct containing details regarding the pool and various tokens in it.
    /// @param _superToken The supertoken which needs to be initialised.
    function initStreamToken(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        ISuperToken _superToken
    ) external {
        address _underlyingToken = _superToken.getUnderlyingToken();
        dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
            _underlyingToken
        ];

        // The underlying token should be accepted by the dHEDGE pool. However,
        // initialising a token which isn't supported by dHEDGE pool at the time of execution-
        // of this function won't create any issues. We can remove this check for gas optimisations.
        require(
            IPoolManagerLogic(
                IPoolLogic(_dHedgePool.poolLogic).poolManagerLogic()
            ).isDepositAsset(_underlyingToken),
            "dHedgeHelper: Not deposit asset"
        );

        // If the underlying token is already initialised, it will already have a corresponding-
        // supertoken. Hence, no need for re-initialisation. If the supertoken turns out to be malicious,
        // then we can't do anything about it after the fact. If possible, check if the supertoken being-
        // initialised was created by the supertoken factory contract. This isn't a major issue though.
        // For the time-being, we can make this function conform to `onlyOwner` condition.
        require(
            address(tokenData.superToken) == address(0),
            "dHedgeHelper: Token already present"
        );

        // Create 2 permanent indices in accordance with `3-index` approach.
        uint32 _latestDistIndex = _dHedgePool.latestDistIndex;
        tokenData.permDistIndex1.indexId = _latestDistIndex;
        tokenData.permDistIndex2.indexId = _latestDistIndex + 1;
        tokenData.tempDistIndex = _latestDistIndex + 2;

        // We will start the stream of the supertoken using the first index and hence, index 2 is locked.
        tokenData.lockedIndexId = _latestDistIndex + 1;
        _dHedgePool.latestDistIndex += 3;

        tokenData.superToken = _superToken;

        bytes memory _newCtx = _dHedgePool.DHPTx.createIndex(_latestDistIndex);
        _newCtx = _dHedgePool.DHPTx.createIndex(_latestDistIndex + 1);
        _newCtx = _dHedgePool.DHPTx.createIndex(_latestDistIndex + 2);

        // Unlimited allowance for the dHEDGE pool so that deposits can take place efficiently.
        IERC20(_underlyingToken).safeIncreaseAllowance(
            _dHedgePool.poolLogic,
            type(uint256).max
        );
    }

    /// Function to deposit tokens into a dHedge pool.
    /// @param _dHedgePool Struct containing details regarding the pool and various tokens in it.
    /// @param _depositToken Address of the underlying token (deposit token and not the supertoken).
    function deposit(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _depositToken
    ) external {
        dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
            _depositToken
        ];
        IPoolLogic _poolLogic = IPoolLogic(_dHedgePool.poolLogic);
        IPoolManagerLogic _supportLogic = IPoolManagerLogic(
            _poolLogic.poolManagerLogic()
        );
        ISuperToken _superToken = tokenData.superToken;
        ISuperToken _DHPTx = _dHedgePool.DHPTx;

        // Scoped to avoid stack too deep errors.
        {
            uint256 _depositCycleDelay = block.timestamp -
                _dHedgePool.lastDepositAt;

            // Tokens are meant to be deposited in a cycle one after another without too much delay.
            // If there is a delay of 15 minutes or more between two token deposits, we stop the cycle-
            // until 24 hours have been passed from the last deposit.
            require(
                _depositCycleDelay < 15 minutes ||
                    _depositCycleDelay >= 24 hours,
                "dHedgeHelper: Next deposit delayed"
            );

            // A particular token can only be deposited once every 24 hours. Sincce there are 2 permanent indices,
            // we have to take the latest deposit timestamp and check for the condition.
            require(
                (block.timestamp -
                    uint64(
                        (tokenData.permDistIndex1.lastDepositAt >
                            tokenData.permDistIndex2.lastDepositAt)
                            ? tokenData.permDistIndex1.lastDepositAt
                            : tokenData.permDistIndex2.lastDepositAt
                    )) >= 24 hours,
                "dHedgeHelper: Less than 24 hours"
            );

            // The underlying token should be accepted for deposit by the dHEDGE pool.
            require(
                _supportLogic.isDepositAsset(_depositToken),
                "dHedgeHelper: Not deposit asset"
            );

            // At least one of the permanent indices should be active. By an active index we mean that,
            // there should at least be one subscriber of that index.
            require(
                tokenData.permDistIndex1.isActive ||
                    tokenData.permDistIndex2.isActive,
                "dHedgeHelper: No index active"
            );
        }

        uint32 _lockedIndexId = tokenData.lockedIndexId;
        uint32 _permDistIndex1 = tokenData.permDistIndex1.indexId;
        uint32 _permDistIndex2 = tokenData.permDistIndex2.indexId;
        uint32 _tempDistIndex = tokenData.tempDistIndex;
        uint256 _superTokenBalance = _superToken.balanceOf(address(this));

        // If `distAmount` is greater than 0 it means previous cycle's DHPT hasn't been distributed.
        // A distribution needs to occur before next deposit of the same underlying token.
        if (tokenData.distAmount != 0) {
            // Upgrade the unlocked DHPT such that DHPT is transferred to SF vesting contract.
            // This is because we have to proceed with next cycle of deposits without locking previous cycles' DHPT.
            _upgradeDHPTx(_poolLogic, _DHPTx);

            // Perform DHPTx distribution along with few other things (detailed later below).
            _distribute(
                _dHedgePool,
                tokenData,
                _DHPTx,
                _lockedIndexId,
                _tempDistIndex
            );
        }

        // If first index is locked but second index is active then proceed with second index.
        if (
            _lockedIndexId == _permDistIndex1 &&
            tokenData.permDistIndex2.isActive
        )
            _lockedIndexId = _permDistIndex2;

        // If index 2 is locked but index 1 is active then proceed with index 1.
        else if (
            _lockedIndexId == _permDistIndex2 &&
            tokenData.permDistIndex1.isActive
        ) _lockedIndexId = _permDistIndex1;

        // Else:
        // - If index 1 is locked and index 2 is inactive then proceed with index 1.
        // - If index 2 is locked and index 1 is inactive then proceed with index 2.

        // Calculate the amount of tokens to deposit for an index.
        uint256 _downgradeAmount = _getSuperTokenDepositBalance(
            _DHPTx,
            _lockedIndexId,
            _permDistIndex1,
            _permDistIndex2,
            _superTokenBalance
        );

        // If there is anything to deposit, only then should the deposit proceed.
        // Index shouldn't be unlocked or locked otherwise.
        if (_downgradeAmount > 0) {
            // Downgrade amount of supertoken required for deposit.
            _superToken.downgrade(_downgradeAmount);

            // Actual deposit logic. Had to break it from the main function due to stack too deep errors.
            _deposit(
                tokenData,
                _depositToken,
                IdHedgeCoreFactory(_dHedgePool.factory),
                _poolLogic
            );
            
            // If `_lockedIndexId` is correct, don't modify it (gas savings).
            if (tokenData.lockedIndexId != _lockedIndexId)
                tokenData.lockedIndexId = _lockedIndexId;

            // Update the timestamp marking when a deposit corresponding to an index took place.
            // This is important as uninvested amount calculations are done using this timestamp among-
            // other reasons.
            (_lockedIndexId == _permDistIndex1)
                ? tokenData.permDistIndex1.lastDepositAt = uint64(
                    block.timestamp
                )
                : tokenData.permDistIndex2.lastDepositAt = uint64(
                block.timestamp
            );

            // Finally, update timestamp indicating when a deposit (of any token) was made into the dHEDGE pool.
            _dHedgePool.lastDepositAt = uint64(block.timestamp);
        }

        console.log("Deposit for index %s complete", _lockedIndexId);
    }
    
    /// Function to distribute DHPTx.
    /// @param _dHedgePool Struct containing details regarding the pool and various tokens in it.
    /// @param _depositToken Address of the underlying token (deposit token and not the supertoken).
    function distribute(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _depositToken
    ) public {
        dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
            _depositToken
        ];
        ISuperToken _DHPTx = _dHedgePool.DHPTx;

        // Upgrade the DHPT in the contract.
        _upgradeDHPTx(IPoolLogic(_dHedgePool.poolLogic), _DHPTx);

        // Should only attempt to distribute DHPTx if there are any to be distributed.
        require(
            tokenData.distAmount != 0 && _DHPTx.balanceOf(address(this)) != 0,
            "dHedgeHelper: No amount to distribute"
        );
        
        // Actual distribution logic (detailed further down).
        _distribute(
            _dHedgePool,
            tokenData,
            _DHPTx,
            tokenData.lockedIndexId,
            tokenData.tempDistIndex
        );
    }

    /// This function serves as the `afterAgreementCreated` hook for Superfluid CFA.
    /// Responsible for actions to be taken after creation of a stream (transfer buffer, update shares, etc.).
    /// @param _dHedgePool Struct containing details regarding the pool and various tokens in it.
    /// @param _sender Address of the user who is updating the stream rate.
    /// @param _agreementClass Tells whether it's CFA or IDA contract call.
    /// @param _underlyingToken Underlying token of the supertoken.
    /// @param _ctx Superfluid context object.
    /// @param _cbdata Callback data passed on from `beforeAgreementCreated` hook.
    function afterAgreementCreated(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        address _sender,
        address _agreementClass,
        address _underlyingToken,
        bytes memory _ctx,
        bytes memory _cbdata
    ) external returns (bytes memory _newCtx) {
        _newCtx = _ctx;

        // Execution should take place only for CFA contract. Ignore for IDA.
        if (
            ISuperAgreement(_agreementClass).agreementType() ==
            keccak256(
                "org.superfluid-finance.agreements.ConstantFlowAgreement.v1"
            )
        ) {
            dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
                _underlyingToken
            ];
            ISuperToken _superToken = tokenData.superToken;
            ISuperToken _DHPTx = _dHedgePool.DHPTx;

            // Select the active index ID.
            uint32 _index = (tokenData.lockedIndexId ==
                tokenData.permDistIndex1.indexId)
                ? tokenData.permDistIndex2.indexId
                : tokenData.permDistIndex1.indexId;
            uint256 _userUninvested = abi.decode(_cbdata, (uint256));

            // Initialise the index in case the index is inactive.
            _initIndex(tokenData, _index);

            // Mark the assigned index of the user. Will be useful when updating/terminating the stream.
            tokenData.assignedIndex[_sender] = _index;

            _transferBuffer(
                _superToken,
                _sender,
                (_index == tokenData.permDistIndex1.indexId)
                    ? tokenData.permDistIndex1.lastDepositAt
                    : tokenData.permDistIndex2.lastDepositAt,
                _userUninvested
            );

            // Assign new units in the active index.
            _newCtx = _superToken.updateSharesInCallback(
                _DHPTx,
                _index,
                _newCtx
            );
        }
    }

    /// This function serves as the `afterAgreementUpdated` hook for Superfluid CFA.
    /// Responsible for actions to be taken after updation of stream rate (transfer buffer, update shares, etc.).
    /// @param _dHedgePool Struct containing details regarding the pool and various tokens in it.
    /// @param _sender Address of the user who is updating the stream rate.
    /// @param _agreementClass Tells whether it's CFA or IDA contract call.
    /// @param _underlyingToken Underlying token of the supertoken.
    /// @param _ctx Superfluid context object.
    /// @param _cbdata Callback data passed on from `beforeAgreementUpdated` hook.
    function afterAgreementUpdated(
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
            dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
                _underlyingToken
            ];
            ISuperToken _superToken = tokenData.superToken;
            ISuperToken _DHPTx = _dHedgePool.DHPTx;

            uint32 _lockedIndexId = tokenData.lockedIndexId;
            uint256 _userUninvested = abi.decode(_cbdata, (uint256));

            // If assigned index is currently locked then we will have to initiate index migration (detailed below).
            if (
                tokenData.distAmount != 0 &&
                tokenData.assignedIndex[_sender] == _lockedIndexId
            ) {
                _migrateIndex(tokenData, _DHPTx, _sender, _newCtx);
            }

            uint32 _currActiveIndex;

            if (tokenData.distAmount != 0) {
                _currActiveIndex = (_lockedIndexId ==
                    tokenData.permDistIndex1.indexId)
                    ? tokenData.permDistIndex2.indexId
                    : tokenData.permDistIndex1.indexId;
            } else {
                _currActiveIndex = tokenData.assignedIndex[_sender];
            }

            _initIndex(tokenData, _currActiveIndex);

            // Modify user's index as the current index.
            if (tokenData.assignedIndex[_sender] != _currActiveIndex)
                tokenData.assignedIndex[_sender] = _currActiveIndex;

            _transferBuffer(
                _superToken,
                _sender,
                (_currActiveIndex == tokenData.permDistIndex1.indexId)
                    ? tokenData.permDistIndex1.lastDepositAt
                    : tokenData.permDistIndex2.lastDepositAt,
                _userUninvested
            );

            // console.log("Reached before updateSharesInCallback");

            // Assigning new units in the active index.
            _newCtx = _superToken.updateSharesInCallback(
                _DHPTx,
                _currActiveIndex,
                _newCtx
            );

            // console.log("End of afterAgreementUpdated");
        }
    }

    function afterAgreementTerminated(
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
            dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
                _underlyingToken
            ];
            // ISuperToken _superToken = tokenData.superToken;
            ISuperToken _DHPTx = _dHedgePool.DHPTx;

            // uint32 _lockedIndexId = tokenData.lockedIndexId;
            uint256 _userUninvested = abi.decode(_cbdata, (uint256));

            // If assigned index is currently locked then we will have to initiate index migration.
            if (
                tokenData.distAmount != 0 &&
                tokenData.assignedIndex[_sender] == tokenData.lockedIndexId
            ) {
                _migrateIndex(tokenData, _DHPTx, _sender, _newCtx);
            } else {
                (uint128 _totalUnits, uint128 _userUnits) = _getUnits(
                    _DHPTx,
                    tokenData.assignedIndex[_sender],
                    _sender
                );

                if (_totalUnits == _userUnits) {
                    if (
                        tokenData.assignedIndex[_sender] ==
                        tokenData.permDistIndex1.indexId
                    ) {
                        tokenData.permDistIndex1.isActive = false;
                        delete tokenData.permDistIndex1.lastDepositAt;
                    } else {
                        tokenData.permDistIndex2.isActive = false;
                        delete tokenData.permDistIndex2.lastDepositAt;
                    }
                }
            }

            delete tokenData.assignedIndex[_sender];

            /// @dev We can directly transfer the amount instead of using `_transferBuffer`.
            _transferBuffer(tokenData.superToken, _sender, 0, _userUninvested);
        }
    }

    /**
     * Helper function that's called before agreements are created, updated or terminated
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
                    (block.timestamp -
                        uint64(
                            (tokenData.permDistIndex1.lastDepositAt >
                                tokenData.permDistIndex2.lastDepositAt)
                                ? tokenData.permDistIndex1.lastDepositAt
                                : tokenData.permDistIndex2.lastDepositAt
                        )) >=
                    24 hours
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
                (tokenData.assignedIndex[_user] ==
                    tokenData.permDistIndex1.indexId)
                    ? tokenData.permDistIndex1.lastDepositAt
                    : tokenData.permDistIndex2.lastDepositAt
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

    function _transferBuffer(
        ISuperToken _superToken,
        address _sender,
        uint64 _lastDepositAt,
        uint256 _userUninvested
    ) private {
        (, int96 _flowRate) = _superToken.getFlow(_sender);
        // uint256 _currFlowRate = uint256(uint96(_flowRate));

        assert(_userUninvested <= _superToken.balanceOf(address(this)));

        // Return some amount if previous flow rate was higher than the current one after update
        uint256 _depositAmount = (block.timestamp - _lastDepositAt) *
            uint256(uint96(_flowRate));

        bool _success;
        if (_depositAmount > _userUninvested) {
            uint256 _amount = _depositAmount - _userUninvested;

            // console.log("Amount to be transferred from: ", _amount);

            _success = _superToken.transferFrom(
                _sender,
                address(this),
                _amount
            );

            emit UpfrontFeeDeposited(_superToken, _sender, _amount);
        } else if (_depositAmount < _userUninvested) {
            uint256 _amount = _userUninvested - _depositAmount;

            // console.log("Amount to be transferred to: ", _amount);

            _success = _superToken.transfer(_sender, _amount);

            emit UpfrontFeeReturned(_superToken, _sender, _amount);
        } else {
            // If `_depositAmount == _userUninvested` then technically no transfer should take place.
            // This case can be reached for the very first streamer of a new supertoken.
            _success = true;
        }

        require(_success, "dHedgeHelper: Buffer transfer failed");
    }

    function _deposit(
        dHedgeStorage.TokenData storage _tokenData,
        address _depositToken,
        IdHedgeCoreFactory _factory,
        IPoolLogic _poolLogic
    ) private {
        uint256 _depositBalance = IERC20Mod(_depositToken).balanceOf(
            address(this)
        );

        // Calculate fee to be collected.
        uint256 _feeCollected = (_depositBalance * _factory.defaultFeeRate()) /
            1e6;

        _depositBalance -= _feeCollected;

        // Perform deposit transaction iff amount of underlying tokens is greater than 0
        if (_depositBalance > 0) {
            // Transfer the fees collected to the owner only if it's greater than 0.
            // This can happen if `defaultFeeRate` is set as 0.
            if (_feeCollected > 0) {
                IERC20(_depositToken).safeTransfer(
                    IdHedgeCoreFactory(_factory).dao(),
                    _feeCollected
                );
            }

            // Deposit the tokens into the dHedge pool
            uint256 _liquidityMinted = _poolLogic.deposit(
                _depositToken,
                _depositBalance
            );

            console.log(
                "Token: %s; Amount: %s, DHPT: %s",
                _depositToken,
                _depositBalance,
                _liquidityMinted
            );

            // Note the amount to be distributed.
            _tokenData.distAmount = _liquidityMinted;

            emit TokenDeposited(
                _depositToken,
                _depositBalance,
                _liquidityMinted
            );
        }
    }

    function _migrateIndex(
        dHedgeStorage.TokenData storage _tokenData,
        ISuperToken _DHPTx,
        address _sender,
        bytes memory _ctx
    ) private returns (bytes memory _newCtx) {
        // console.log("Index migration begun");

        _newCtx = _ctx;
        uint32 _lockedIndexId = _tokenData.lockedIndexId;

        // Index migration is done by deleting a sender's subscription in the locked index
        // and assigning new units in the active index along with assigning new units in temporary
        // index.
        (uint128 _totalUnits, uint128 _userUnits) = _getUnits(
            _DHPTx,
            _lockedIndexId,
            _sender
        );

        uint256 _tempDistAmount = _tokenData.tempDistAmount;

        // Calculating a user's pending locked tokens amount by using units issued to the user,
        // total units issued and total amount of DHPT in this contract (this is the locked amount)
        _tempDistAmount += ((_userUnits *
            (_tokenData.distAmount - _tempDistAmount)) / _totalUnits);

        _tokenData.tempDistAmount = _tempDistAmount;

        console.log(
            "Temp dist amount in migration: %s",
            _tokenData.tempDistAmount
        );

        // Check if the total units of the locked index is equal to only the user's units.
        // We will have to make this index inactive if the condition is true.
        /// @dev We may have to make the `lastDepositAt` for the inactive index 0 as well.
        if (_totalUnits == _userUnits) {
            if (_lockedIndexId == _tokenData.permDistIndex1.indexId) {
                _tokenData.permDistIndex1.isActive = false;
                delete _tokenData.permDistIndex1.lastDepositAt;
            } else {
                _tokenData.permDistIndex2.isActive = false;
                delete _tokenData.permDistIndex2.lastDepositAt;
            }
        }

        // Deleting units of the user in locked index
        _newCtx = _DHPTx.deleteSubscriptionInCallback(_lockedIndexId, _newCtx);

        console.log("Subscription deleted from index: %s", _lockedIndexId);

        // Assigning units in temporary index
        _newCtx = _DHPTx.updateSharesInCallback(
            _tokenData.tempDistIndex,
            _userUnits,
            _newCtx
        );

        // console.log("Reached after share update");
    }

    function _initIndex(
        dHedgeStorage.TokenData storage _tokenData,
        uint32 _index
    ) private {
        if (
            _index == _tokenData.permDistIndex1.indexId &&
            !_tokenData.permDistIndex1.isActive
        ) {
            _tokenData.permDistIndex1.isActive = true;

            if (_tokenData.permDistIndex1.lastDepositAt == 0) {
                _tokenData.permDistIndex1.lastDepositAt = uint64(
                    block.timestamp
                );
            }
        } else if (
            _index == _tokenData.permDistIndex2.indexId &&
            !_tokenData.permDistIndex2.isActive
        ) {
            _tokenData.permDistIndex2.isActive = true;

            if (_tokenData.permDistIndex2.lastDepositAt == 0) {
                _tokenData.permDistIndex2.lastDepositAt = uint64(
                    block.timestamp
                );
            }
        }
    }

    function _getUnits(
        ISuperToken _DHPTx,
        uint32 _indexId,
        address _sender
    ) private view returns (uint128, uint128) {
        // Index migration is done by deleting a sender's subscription in the locked index
        // and assigning new units in the active index along with assigning new units in temporary
        // index.
        (, , uint128 _userUnits, ) = _DHPTx.getSubscription(_indexId, _sender);

        (
            ,
            ,
            uint128 _totalLockedIndexApprovedUnits,
            uint128 _totalLockedIndexPendingUnits
        ) = _DHPTx.getIndex(_indexId);

        return (
            _totalLockedIndexApprovedUnits + _totalLockedIndexPendingUnits,
            _userUnits
        );
    }

    function _distribute(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        dHedgeStorage.TokenData storage _tokenData,
        ISuperToken _DHPTx,
        uint32 _permDistIndex,
        uint32 _tempDistIndex
    ) private {
        uint256 _totalDistAmount = _tokenData.distAmount;
        uint256 _tempDistAmount = _tokenData.tempDistAmount;

        console.log(
            "Dist amount: %s, Temp amount: %s",
            _totalDistAmount,
            _tempDistAmount
        );

        uint256 _actualPermDistAmount = _totalDistAmount - _tempDistAmount;

        if (_totalDistAmount != 0) {
            _tokenData.distAmount = 0;

            if (_actualPermDistAmount != 0) {
                console.log("Perm dist index: %s", _permDistIndex);
                _DHPTx.distribute(_permDistIndex, _actualPermDistAmount);
            }

            // If there were some units in temporary index then create a new temporary index
            if (_tempDistAmount != 0) {
                console.log("Temporary dist index: %s", _tempDistIndex);

                _tokenData.tempDistAmount = 0;
                _DHPTx.distribute(_tempDistIndex, _tempDistAmount);

                // Create new temporary index
                _createTempIndex(_dHedgePool, _tokenData, _DHPTx);
            }
        }
    }

    function _createTempIndex(
        dHedgeStorage.dHedgePool storage _dHedgePool,
        dHedgeStorage.TokenData storage _tokenData,
        ISuperToken _DHPTx
    ) private {
        uint32 _latestDistIndex = _dHedgePool.latestDistIndex;

        // Create new temporary index.
        _DHPTx.createIndex(_latestDistIndex);

        // Store the index Id of the temporary index.
        _tokenData.tempDistIndex = _latestDistIndex;

        ++_dHedgePool.latestDistIndex;

        console.log("Created new temp index: %s", _latestDistIndex);
    }

    function _upgradeDHPTx(IPoolLogic _poolLogic, ISuperToken _DHPTx) private {
        uint256 _superTokenBalance = IERC20Mod(address(_poolLogic)).balanceOf(
            address(this)
        );

        if (
            _poolLogic.getExitRemainingCooldown(address(this)) == 0 &&
            _superTokenBalance > 0
        ) {
            _DHPTx.upgrade(_superTokenBalance);
        }
    }

    function _getSuperTokenDepositBalance(
        ISuperToken _DHPTx,
        uint32 _currDistIndex,
        uint32 _permDistIndex1,
        uint32 _permDistIndex2,
        uint256 _superTokenBalance
    ) private view returns (uint256) {
        // Calculate and downgrade amount necessary for deposition in dHEDGE pool
        (
            ,
            ,
            uint128 _totalIndexApprovedUnits1,
            uint128 _totalIndexPendingUnits1
        ) = _DHPTx.getIndex(_permDistIndex1);

        (
            ,
            ,
            uint128 _totalIndexApprovedUnits2,
            uint128 _totalIndexPendingUnits2
        ) = _DHPTx.getIndex(_permDistIndex2);

        uint128 _totalIndexUnits1 = _totalIndexApprovedUnits1 +
            _totalIndexPendingUnits1;

        uint128 _totalIndexUnits2 = _totalIndexApprovedUnits2 +
            _totalIndexPendingUnits2;

        console.log(
            "Total index units 1 and 2: %s, %s",
            _totalIndexUnits1,
            _totalIndexUnits2
        );

        return
            ((
                (_currDistIndex == _permDistIndex1)
                    ? _totalIndexUnits1
                    : _totalIndexUnits2
            ) * _superTokenBalance) / (_totalIndexUnits1 + _totalIndexUnits2);
    }
}
