// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {IPoolLogic} from "./Interfaces/IdHedge.sol";
import {IdHedgeCore, IdHedgeUpkeep} from "./Interfaces/ISuperdHedge.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "hardhat/console.sol";

/**
 * @title dHedge upkeep contract
 * @author rashtrakoff
 * @dev Resolver contract for keepers
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable not-rely-on-time
// solhint-disable reason-string
// solhint-disable-next-line contract-name-camelcase
contract dHedgeUpkeepGelato is Ownable, IdHedgeUpkeep {
    // Mapping to represent upkeep status of a contract (true -> ongoing/unpaused, false -> paused)
    mapping(address => bool) private upkeepSet;

    /// @dev Pauses a core contract from upkeep services
    /// @param _contract Address of the core contract
    function pauseContract(address _contract) external {
        _onlyOwner(msg.sender);
        require(upkeepSet[_contract], "dHedgeUpkeep: Contract already paused");

        upkeepSet[_contract] = false;

        emit CorePaused(_contract);
    }

    /// @dev Unpauses a core contract from upkeep services
    /// @param _contract Address of the core contract
    /// Unpausing and adding a contract are equivalent actions
    function unPauseContract(address _contract) external {
        _onlyOwner(msg.sender);
        require(
            !upkeepSet[_contract],
            "dHedgeUpkeep: Contract already unpaused"
        );

        upkeepSet[_contract] = true;

        emit CoreUnPaused(_contract);
    }

    /// @dev Calls deposit function in a core contract. Should be used by keepers.
    /// @param _contract Address of the core contract
    /// @param _depositToken Address of the token to be deposited
    function performUpkeep(address _contract, address _depositToken)
        external
        override
    {
        try IdHedgeCore(_contract).dHedgeDeposit(_depositToken) {
            emit DepositSuccess(_contract, _depositToken);
        } catch (bytes memory _err) {
            upkeepSet[_contract] = false;

            emit DepositFailed(_contract, _depositToken, _err);
        }
    }

    /// @dev Function which checks if any of the registered core contracts require upkeep
    function checkUpkeep(address _contract)
        external
        view
        override
        returns (bool _canExec, bytes memory _execPayload)
    {
        if (upkeepSet[_contract]) {
            try IdHedgeCore(_contract).requireUpkeep() returns (
                bool _result,
                address _token
            ) {
                _canExec = _result;

                _execPayload = abi.encodeWithSelector(
                    IdHedgeUpkeep.performUpkeep.selector,
                    _contract,
                    _token
                );
            } catch (bytes memory error) {
                // To allow debugging using Tenderly dashboard
                console.logBytes(error);
            }
        }
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

    function _onlyOwner(address _user) internal view {
        require(_user == owner(), "dHedgeUpkeepGelato: Not the owner");
    }
}
