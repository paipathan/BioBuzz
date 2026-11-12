package org.firstinspires.ftc.teamcode.subsystems;

import com.pedropathing.ivy.Command;

import org.firstinspires.ftc.teamcode.util.Constants;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextMotor;
import dev.nextftc.hardware.actuators.NextServo;
import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.Telemetry;

public class Transfer implements Mechanism {
    public enum State {
        OFF(0.0, Constants.Transfer.stopperClosedPosition),
        LOAD(1.0, Constants.Transfer.stopperClosedPosition),
        FEED(1.0, Constants.Transfer.stopperOpenPosition),
        UNJAM(-1.0, Constants.Transfer.stopperClosedPosition);

        private final double power;
        private final double stopperPosition;

        State(double power, double stopperPosition) {
            this.power = power;
            this.stopperPosition = stopperPosition;
        }
    }

    private State state = State.OFF;

    NextMotor transferMotor1;
    NextMotor transferMotor2;
    NextServo stopperServo;

    public void initialize() {
        if (transferMotor1 == null) {
            transferMotor1 = new NextMotor(RobotController.expansionHub(), Constants.Transfer.transferMotorPort1);
            transferMotor2 = new NextMotor(RobotController.controlHub(), Constants.Transfer.transferMotorPort2);
        }
        transferMotor1.setDirection(Constants.Transfer.transferMotorDirection1);
        transferMotor2.setDirection(Constants.Transfer.transferMotorDirection2);
        transferMotor1.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.BRAKE);
        transferMotor2.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.BRAKE);
        if (stopperServo == null) {
            stopperServo = new NextServo(RobotController.expansionHub(), Constants.Transfer.stopperServoPort, Constants.Transfer.stopperServoCacheTolerance, Constants.Transfer.stopperServoDirection);
        }
    }

    public Command set(State state) {
        return instant(() -> this.state = state);
    }

    public State getState() {
        return state;
    }

    @Override
    public void periodic() {
        if (transferMotor1 == null) return;
        transferMotor1.setThrottle(state.power);
        transferMotor2.setThrottle(state.power);
        if (stopperServo != null) stopperServo.setPosition(state.stopperPosition);
        Telemetry.log("transfer", state);
    }
}
