// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {ISuperfluid, ISuperToken, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {IInstantDistributionAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IInstantDistributionAgreementV1.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./Libraries/dHedgeHelper.sol";
import "./Libraries/dHedgeStorage.sol";
import "./Interfaces/IdHedgeCoreFactory.sol";
// import "hardhat/console.sol";

/**
 * @title Core contract for streaming into a dHedge pool
 * @author rashtrakoff
 * @notice Contains user facing functions
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable reason-string
// solhint-disable var-name-mixedcase
// solhint-disable-next-line contract-name-camelcase
contract dHedgeCore is Initializable, SuperAppBase {
    using SafeERC20 for IERC20;
    using dHedgeHelper for dHedgeStorage.dHedgePool;
    using SFHelper for ISuperToken;


    // Struct containing all the relevant data regarding the dHedgePool this dHedgeCore serves
    dHedgeStorage.dHedgePool private poolData;


    /// @dev Initialize the factory
    /// @param _dHedgePool dHEDGE pool contract address
    /// @param _DHPTx Supertoken corresponding to the DHPT of the pool
    function initialize(
        address _dHedgePool,
        ISuperToken _DHPTx
    ) external initializer {
        poolData.isActive = true;
        poolData.factory = msg.sender;
        poolData.DHPTx = _DHPTx;
        poolData.poolLogic = _dHedgePool;

        IERC20(_dHedgePool).safeIncreaseAllowance(
            address(_DHPTx),
            type(uint256).max
        );
    }


    /**************************************************************************
     * Core functions
     *************************************************************************/

    /// @notice Converts supertokens to underlying tokens and deposits them into dHedge pool
    /// @param _token Address of the underlying token to be deposited into dHedge pool
    function dHedgeDeposit(address _token) external {
        _onlyActive();
        poolData.deposit(_token);
    }

    /// @dev Function to withdraw a token in case of emergency
    /// @param _token Address of the pool token
    /// @custom:note Remove/Modify this function after testing
    function emergencyWithdraw(address _token) external {
        _onlyOwner(msg.sender);
        IERC20(_token).safeTransfer(
            IdHedgeCoreFactory(poolData.factory).dao(),
            IERC20(_token).balanceOf(address(this))
        );
    }

    /// @dev Deactivates a dHedgeCore contract
    function deactivateCore() external {
        _onlyOwner(msg.sender);
        _onlyActive();

        poolData.isActive = false;
    }

    /// @dev Reactivates a dHedgeCore contract
    function reactivateCore() external {
        _onlyOwner(msg.sender);
        require(!poolData.isActive, "dHedgeCore: Pool already active");

        poolData.isActive = true;
    }

    /// @notice Checks if the core is active or not
    /// @return Boolean indicating working status of core
    function checkCoreActive() external view returns (bool) {
        return poolData.isActive;
    }

    // /// @notice Gets pool address
    // /// @return Returns address of the dHedge pool this core contract serves
    // function getPoolLogic() external view returns (address) {
    //     return poolData.poolLogic;
    // }

    /// @dev Gets the latest distribution index created
    /// @return Number corresponding to the latest created index
    /// This function can also be used to get number of tokens supported by this dHedgeCore
    function getLatestDistIndex() external view returns (uint32) {
        return poolData.latestDistIndex;
    }

    /// @dev Gets the distribution index corresponding to an underlying token
    /// @param _token Address of a deposit token
    /// @return Boolean depicting if a distribution index exists for `_token`
    /// @return Number representing the index value corresponding to `_token` if it exists
    function getTokenDistIndex(address _token)
        external
        view
        returns (bool, uint32)
    {
        if (address(poolData.tokenData[_token].superToken) != address(0))
            return (true, poolData.tokenData[_token].distIndex);

        return (false, 0);
    }

    /// @notice Calculates uninvested token amount of a particular user
    /// @param _user Address of the user whose uninvested amount needs to be calculated
    /// @param _token Address of the underlying token
    /// @return Amount of uninvested tokens
    function calcUserUninvested(address _user, address _token)
        public
        view
        returns (uint256)
    {
        return poolData.calcUserUninvested(_user, _token);
    }

    /// @dev Checks if deposit action can be performed
    /// @return Boolean indicating if upkeep/deposit can be performed
    /// @return Address of the underlying/deposit token which needs to be deposited to the dHedge pool
    function requireUpkeep() public view returns (bool, address) {
        return poolData.requireUpkeep();
    }

    /// @dev Checks status of the core and reverts if inactive
    function _onlyActive() internal view {
        require(poolData.isActive, "dHedgeCore: Pool inactive");
    }

    /// @dev Equivalent to onlyOwner modifier
    function _onlyOwner(address _user) internal view {
        require(
            _user == Ownable(poolData.factory).owner(),
            "dHedgeCore: Not the owner"
        );
    }

    /// @dev Checks if the caller is the SF host contract
    function _onlyHost() internal view {
        require(
            msg.sender == address(SFHelper.HOST),
            "dHedgeCore: Supports only one host"
        );
    }

    /// @dev Checks if the agreement is of type CFA
    function _onlyExpected(address _agreementClass) internal view {
        require(
            ISuperAgreement(_agreementClass).agreementType() ==
                keccak256(
                    "org.superfluid-finance.agreements.ConstantFlowAgreement.v1"
                ) ||
                ISuperAgreement(_agreementClass).agreementType() ==
                keccak256(
                    "org.superfluid-finance.agreements.InstantDistributionAgreement.v1"
                ),
            "dHedgeCore: Callback called illegaly"
        );
    }


    /**************************************************************************
     * SuperApp callbacks
     *************************************************************************/

    function beforeAgreementCreated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata // _ctx
    ) external view override returns (bytes memory _cbdata) {
        _onlyHost();
        _onlyExpected(_agreementClass);
        _onlyActive();

        address _underlyingToken = _superToken.getUnderlyingToken();
        ISuperToken _superStreamToken = poolData
            .tokenData[_underlyingToken]
            .superToken;

        require(
            address(_superStreamToken) == address(0) ||
                _superStreamToken == _superToken,
            "dHedgeCore: Supertoken not supported"
        );
        require(
            poolData.isDepositAsset(_underlyingToken),
            "dHedgeCore: Not deposit asset"
        );

        _cbdata = new bytes(0);
    }

    function afterAgreementCreated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, // _agreementId,
        bytes calldata, // _agreementData,
        bytes calldata, // _cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        _onlyHost();
        _onlyExpected(_agreementClass);

        address _underlyingToken = _superToken.getUnderlyingToken();
        dHedgeStorage.TokenData storage tokenData = poolData.tokenData[
            _underlyingToken
        ];

        /* 
            Check if the underlying token is enabled as deposit asset. If not, 
            revert the transaction as the tokens can't be deposited into the pool.
            If yes:
                Map supertoken to the underlying token.
                Unlimited approve underlying token to the dHedge pool.
        */
        if (address(tokenData.superToken) == address(0)) {
            tokenData.superToken = _superToken;
            tokenData.distIndex = poolData.latestDistIndex++;

            // console.log(
            //     "Index for token %s: %s",
            //     _underlyingToken,
            //     tokenData.distIndex
            // );

            poolData.DHPTx.createIndexInCallback(tokenData.distIndex, _ctx);

            IERC20(_underlyingToken).safeIncreaseAllowance(
                poolData.poolLogic,
                type(uint256).max
            );
        }

        _newCtx = _superToken.updateSharesInCallback(
            poolData.DHPTx,
            tokenData.distIndex,
            _ctx
        );
    }

    function beforeAgreementUpdated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata _ctx
    ) external view override returns (bytes memory _cbdata) {
        _onlyHost();
        _onlyExpected(_agreementClass);
        _onlyActive();

        _cbdata = poolData.beforeAgreement(
            _agreementClass,
            _superToken.getUnderlyingToken(),
            _ctx
        );
    }

    function afterAgreementUpdated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, //_agreementId,
        bytes calldata, //_agreementData,
        bytes calldata _cbdata, //_cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        _onlyHost();
        _onlyExpected(_agreementClass);

        _newCtx = poolData.afterAgreement(
            _agreementClass,
            _superToken.getUnderlyingToken(),
            _ctx,
            _cbdata
        );
    }

    function beforeAgreementTerminated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata _ctx
    ) external view override returns (bytes memory _cbdata) {
        _onlyHost();
        _onlyExpected(_agreementClass);

        _cbdata = poolData.beforeAgreement(
            _agreementClass,
            _superToken.getUnderlyingToken(),
            _ctx
        );
    }

    function afterAgreementTerminated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, //_agreementId,
        bytes calldata, // _agreementData,
        bytes calldata _cbdata, //_cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        _onlyHost();
        _onlyExpected(_agreementClass);

        _newCtx = poolData.afterAgreement(
            _agreementClass,
            _superToken.getUnderlyingToken(),
            _ctx,
            _cbdata
        );
    }
}