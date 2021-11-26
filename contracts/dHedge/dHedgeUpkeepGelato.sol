// SPDX-License-Identifier: Unlicensed
pragma solidity ^0.8.4;

import {IPoolLogic} from "./Interfaces/IdHedge.sol";
import {IdHedgeCore, IdHedgeUpkeep} from "./Interfaces/ISuperdHedge.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "hardhat/console.sol";

/**
 * @title dHedge upkeep contract
 * @author rashtrakoff
 * @dev Resolver contract for keepers
 * @custom:experimental This is an experimental contract/library. Use at your own risk.
 */
// solhint-disable reason-string
// solhint-disable-next-line contract-name-camelcase
contract dHedgeUpkeepGelato is Ownable, IdHedgeUpkeep {
    using EnumerableSet for EnumerableSet.AddressSet;

    error DepositFailed(bytes err);

    EnumerableSet.AddressSet private upkeepSet;

    /// @dev Add a core contract for upkeep
    /// @param _contract Address of the core contract
    function addContract(address _contract) external onlyOwner {
        require(_isContract(_contract), "dHedgeUpkeep: Not a contract");
        require(
            !upkeepSet.contains(_contract),
            "dHedgeUpkeep: Contract already present"
        );

        upkeepSet.add(_contract);

        // solhint-disable-next-line not-rely-on-time
        emit CoreAdded(_contract, block.timestamp);
    }

    /// @dev Removes a core contract from upkeep services
    /// @param _contract Address of the core contract
    function removeContract(address _contract) external onlyOwner {
        require(
            upkeepSet.contains(_contract),
            "dHedgeUpkeep: Contract not present"
        );

        upkeepSet.remove(_contract);

        // solhint-disable-next-line not-rely-on-time
        emit CoreRemoved(_contract, block.timestamp);
    }

    /// @dev Calls deposit function in a core contract. Should be used by keepers.
    /// @param _contract Address of the core contract
    function callFunction(address _contract) external override {
        try IdHedgeCore(_contract).dHedgeDeposit() {
            console.log("Execution successful for contract %s", _contract);
            
            // solhint-disable-next-line not-rely-on-time
            emit DepositCalled(_contract, block.timestamp);
        } catch (bytes memory err) {
            // To allow debugging using Tenderly dashboard
            console.log(
                "Error encountered for contract %s with error: ",
                _contract
            );
            console.logBytes(err);
            
            revert DepositFailed(err);
        }
    }

    /// @dev Function which checks if any of the registered core contracts require upkeep
    function checker()
        external
        view
        override
        returns (bool _canExec, bytes memory _execPayload)
    {
        for (uint256 i = 0; i < upkeepSet.length(); ++i) {
            address _contract = upkeepSet.at(i);
            try IdHedgeCore(_contract).requireUpkeep() returns (bool _result) {
                _canExec = _result;

                _execPayload = abi.encodeWithSelector(
                    IdHedgeUpkeep.callFunction.selector,
                    _contract
                );

                console.log("Check successful for contract %s", _contract);

                if (_canExec) break;
            } catch (bytes memory error) {
                // To allow debugging using Tenderly dashboard
                console.log(
                    "Error encountered for contract %s with error: ",
                    _contract
                );
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
}
