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
interface IERC20Mod {
    function decimals() external view returns (uint8);
}

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
    using SafeERC20 for IERC20;
    using SFHelper for ISuperToken;

    event TokenDeposited(
        address _token,
        uint256 _amount,
        uint256 _liquidityMinted
    );

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
                _dHedgePool.tokenData[_depositToken].lastDepositAt) >= 24 hours,
            "dHedgeHelper: Time difference exceeds limit"
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

            // Downgrade all supertokens to their underlying tokens
            tokenData.superToken.downgrade(
                tokenData.superToken.balanceOf(address(this))
            );

            uint256 _depositBalance = IERC20(_depositToken).balanceOf(
                address(this)
            );

            // Calculate fee to be collected
            uint256 _feeCollected = (_depositBalance *
                IdHedgeCoreFactory(_dHedgePool.factory).defaultFeeRate()) / 1e6;

            _depositBalance -= _feeCollected;

            // Perform deposit transaction iff amount of underlying tokens is greater than 0
            if (_depositBalance > 0) {
                // Store the timestamp of last time a deposit & distribution was made
                tokenData.lastDepositAt = block.timestamp;

                // Transfer the fees collected to the owner
                IERC20(_depositToken).safeTransfer(
                    IdHedgeCoreFactory(_dHedgePool.factory).dao(),
                    _feeCollected
                );

                // Deposit the tokens into the dHedge pool
                uint256 _liquidityMinted = _poolLogic.deposit(
                    _depositToken,
                    _depositBalance
                );

                // Upgrade recently minted DHPT to DHPTx
                _dHedgePool.DHPTx.upgrade(_liquidityMinted);

                // Distribute the DHPTx to streamers
                _dHedgePool.DHPTx.distribute(
                    tokenData.distIndex,
                    _dHedgePool.DHPTx.balanceOf(address(this))
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
            address _sender = SFHelper.HOST.decodeCtx(_newCtx).msgSender;
            uint256 _userUninvested = abi.decode(_cbdata, (uint256));

            dHedgeStorage.TokenData storage tokenData = _dHedgePool.tokenData[
                _underlyingToken
            ];
            (, int96 _flowRate) = tokenData.superToken.getFlow(_sender);
            uint256 _currFlowRate = uint256(uint96(_flowRate));
            
            assert(
                _userUninvested <= tokenData.superToken.balanceOf(address(this))
            );

            // Return some amount if previous flow rate was higher than the current one after update
            uint256 _depositAmount = (block.timestamp -
                tokenData.lastDepositAt) * _currFlowRate;

            bool success;
            if (_depositAmount > _userUninvested) {
                success = tokenData.superToken.transferFrom(
                    _sender,
                    address(this),
                    _depositAmount - _userUninvested
                );
            } else if (_depositAmount < _userUninvested) {
                success = tokenData.superToken.transfer(
                    _sender,
                    _userUninvested - _depositAmount
                );
            }

            require(success, "dHedgeHelper: Buffer transfer failed");

            _newCtx = tokenData.superToken.updateSharesInCallback(
                _dHedgePool.DHPTx,
                tokenData.distIndex,
                _newCtx
            );


            // require(
            //     tokenData.superToken.transfer(_sender, _userUninvested),
            //     "dHedgeHelper: Uninvested amount transfer failed"
            // );
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
