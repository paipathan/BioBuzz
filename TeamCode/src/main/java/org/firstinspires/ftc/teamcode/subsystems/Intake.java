package org.firstinspires.ftc.teamcode.subsystems;

import com.pedropathing.ivy.Command;

import org.firstinspires.ftc.teamcode.util.Constants;

import dev.nextftc.hardware.actuators.NextMotor;
import dev.nextftc.robot.Mechanism;

public class Intake implements Mechanism {
    private State state = State.OFF;
    public enum State {
        OFF,
        INTAKE
    }

    NextMotor intakeMotor = new NextMotor(Constants.Intake.intakeMotorName);

    public Intake() {
        intakeMotor.setDirection(NextMotor.Direction.FORWARD);
        intakeMotor.setZeroPowerBehavior(NextMotor.ZeroPowerBehavior.FLOAT);
    }

    public Command set(State state) {
        return instant(() -> this.state = state);
    }

    public State getState() {
        return state;
    }

    @Override
    public void periodic() {
        switch (state) {
            case OFF:
                intakeMotor.setThrottle(0.0);
                break;
            case INTAKE:
                intakeMotor.setThrottle(1.0);
                break;
        }
    }
}
