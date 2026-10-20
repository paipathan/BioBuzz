package org.firstinspires.ftc.teamcode.util;

public enum Alliance {
    BLUE(0.0),
    RED(Math.PI);

    public final double fieldCentricOffset;

    Alliance(double fieldCentricOffset) {
        this.fieldCentricOffset = fieldCentricOffset;
    }
}
