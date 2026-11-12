package org.firstinspires.ftc.teamcode.subsystems;

import com.pedropathing.ivy.Command;

import org.firstinspires.ftc.teamcode.util.Constants;

import dev.nextftc.hardware.actuators.NextMotor;
import dev.nextftc.robot.Mechanism;

public class Intake implements Mechanism {
    public enum State {
        OFF(0.0),
        INTAKE(1.0),
        UNJAM(-1.0);

        private final double power;

        State(double power) {
            this.power = power;
        }
    }

    private State state = State.OFF;

    NextMotor intakeMotor;

    public void initialize() {
        if (intakeMotor == null) {
            intakeMotor = new NextMotor(Constants.Intake.intakeMotorName);
        }
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
        if (intakeMotor == null) return;
        intakeMotor.setThrottle(state.power);
    }
}
