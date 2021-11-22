// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {IdHedgeBank} from "./Interfaces/ISuperdHedge.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// import "hardhat/console.sol";

/**
 * @title dHedge bank contract
 * @author rashtrakoff
 * @dev Accounts for LP tokens received by different core contracts
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable reason-string
// solhint-disable-next-line contract-name-camelcase
contract dHedgeBank is Ownable, IdHedgeBank {
    using SafeERC20 for IERC20;

    mapping(address => mapping(address => uint256)) private depositContracts;

    /// @dev Function called by core contracts for depositing their LP tokens
    /// @param _poolToken Address of the dHedge pool
    /// @param _amount Amount of LP tokens to be deposited
    function deposit(address _poolToken, uint256 _amount) external override {
        require(
            _isContract(msg.sender),
            "dHedgeBank: Depositor not a contract"
        );
        require(
            Ownable(msg.sender).owner() == owner(),
            "dHedgeBank: Owner of deposit contract not authorised"
        );

        IERC20(_poolToken).safeTransferFrom(msg.sender, address(this), _amount);
        depositContracts[msg.sender][_poolToken] += _amount;
    }

    /// @dev Function called by core contracts to transfer LP tokens to investors
    /// @param _poolToken Address of the dHedge pool
    /// @param _user Address of the user to whom LP tokens are to be transferred
    /// @param _amount Amount of tokens to be transferred to the user
    function withdraw(
        address _poolToken,
        address _user,
        uint256 _amount
    ) external override {
        require(
            _isContract(msg.sender),
            "dHedgeBank: Withdrawer not a contract"
        );
        require(
            Ownable(msg.sender).owner() == owner(),
            "dHedgeBank: Owner of deposit contract not authorised"
        );
        require(
            depositContracts[msg.sender][_poolToken] >= _amount,
            "dHedgeBank: Amount exceeds limit"
        );

        depositContracts[msg.sender][_poolToken] -= _amount;
        IERC20(_poolToken).safeTransfer(_user, _amount);
    }

    /// @dev Checks if a given address is a contract or not
    /// @param account Address of the account
    function _isContract(address account) internal view returns (bool) {
        // This method relies on extcodesize, which returns 0 for contracts in
        // construction, since the code is only stored at the end of the
        // constructor execution.

        /* solhint-disable no-inline-assembly */
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
        /* solhint-enable no-inline-assembly */
    }
}
