package org.firstinspires.ftc.teamcode.subsystems;

import com.pedropathing.ivy.Command;

import org.firstinspires.ftc.teamcode.util.Constants;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextMotor;
import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.Telemetry;

public class Transfer implements Mechanism {
    private State state = State.OFF;
    public enum State {
        OFF,
        RUNNING,
        UNJAM
    }

    NextMotor transferMotor1;
    NextMotor transferMotor2;

    public void initialize() {
        if (transferMotor1 == null) {
            transferMotor1 = new NextMotor(RobotController.expansionHub(), Constants.Transfer.transferMotorPort1);
            transferMotor2 = new NextMotor(RobotController.controlHub(), Constants.Transfer.transferMotorPort2);
        }
        transferMotor1.setDirection(Constants.Transfer.transferMotorDirection1);
        transferMotor2.setDirection(Constants.Transfer.transferMotorDirection2);
        transferMotor1.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.BRAKE);
        transferMotor2.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.BRAKE);
    }

    public Command set(State state) {
        return instant(() -> this.state = state);
    }

    public State getState() {
        return state;
    }

    private void setThrottle(double throttle) {
        transferMotor1.setThrottle(throttle);
        transferMotor2.setThrottle(throttle);
    }

    @Override
    public void periodic() {
        if (transferMotor1 == null) return;
        switch (state) {
            case OFF:
                setThrottle(0.0);
                break;
            case RUNNING:
                setThrottle(1.0);
                break;
            case UNJAM:
                setThrottle(-1.0);
                break;
        }
        Telemetry.log("transfer", state);
    }
}
